import { z } from 'zod'
import type { GraphIndex } from '../model/graphIndex'

const highlightRole = z.enum(['subject', 'affected', 'related', 'path'])

/**
 * Declarative visual explanations. The model only names graph elements; the UI computes and draws
 * everything else, so no model output is ever executed. New kinds are added to this union.
 */
const visualSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('whatIfRemove'),
    nodeIds: z.array(z.string()).describe('削除を仮定するノード ID'),
  }),
  z.object({
    type: z.literal('trace'),
    label: z.string(),
    edgeIds: z.array(z.string()).describe('順番に辿るエッジ ID'),
  }),
])

export const answerSchema = z.object({
  summary: z.string().describe('1〜2 文の要約'),
  segments: z
    .array(
      z.object({
        text: z.string(),
        refs: z.array(z.string()).describe('この文が説明しているノード ID / エッジ ID'),
      }),
    )
    .describe('図と対応付けた説明。2〜5 個'),
  highlights: z.array(z.object({ ref: z.string(), role: highlightRole })),
  visuals: z.array(visualSchema),
  followUps: z
    .array(z.object({ question: z.string(), focusRef: z.string().nullable() }))
    .describe('次に問うとよい質問。focusRef はその質問の対象'),
})

export type Answer = z.infer<typeof answerSchema>
export type Visual = z.infer<typeof visualSchema>
export type HighlightRole = z.infer<typeof highlightRole>

export type AnswerIssue =
  | { kind: 'unknownRef'; where: 'segment' | 'highlight' | 'followUp'; ref: string }
  | { kind: 'visualDropped'; visual: Visual['type']; unknownRefs: string[] }

export interface ValidatedAnswer {
  answer: Answer
  issues: AnswerIssue[]
}

export class AnswerFormatError extends Error {}

/**
 * Checks that every id the model referenced exists in the graph. Unknown ids in supporting places
 * are removed and reported; a visual with any unknown id is dropped as a whole, because drawing
 * half of a trace or a removal would show a structure the answer did not describe.
 */
export function validateAnswer(raw: unknown, index: GraphIndex): ValidatedAnswer {
  const parsed = answerSchema.safeParse(raw)
  if (!parsed.success) throw new AnswerFormatError(`回答の形式が不正です: ${parsed.error.message}`)
  const answer = parsed.data
  const issues: AnswerIssue[] = []
  const exists = (ref: string) => index.hasNode(ref) || index.hasEdge(ref)
  const keepKnown = (refs: string[], where: 'segment' | 'highlight' | 'followUp') =>
    refs.filter((ref) => {
      if (exists(ref)) return true
      issues.push({ kind: 'unknownRef', where, ref })
      return false
    })

  const segments = answer.segments.map((segment) => ({ ...segment, refs: keepKnown(segment.refs, 'segment') }))
  const highlights = answer.highlights.filter((highlight) => keepKnown([highlight.ref], 'highlight').length > 0)
  const followUps = answer.followUps.map((followUp) =>
    followUp.focusRef === null || keepKnown([followUp.focusRef], 'followUp').length > 0 ? followUp : { ...followUp, focusRef: null },
  )
  const visuals = answer.visuals.filter((visual) => {
    const unknownRefs =
      visual.type === 'whatIfRemove'
        ? visual.nodeIds.filter((id) => !index.hasNode(id))
        : visual.edgeIds.filter((id) => !index.hasEdge(id))
    const empty = visual.type === 'whatIfRemove' ? visual.nodeIds.length === 0 : visual.edgeIds.length === 0
    if (unknownRefs.length === 0 && !empty) return true
    issues.push({ kind: 'visualDropped', visual: visual.type, unknownRefs })
    return false
  })

  return { answer: { ...answer, segments, highlights, followUps, visuals }, issues }
}
