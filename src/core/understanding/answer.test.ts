import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../model/graphIndex'
import { miniGraph } from '../testing/miniGraph'
import { AnswerFormatError, validateAnswer, type Answer } from './answer'

const index = new GraphIndex(miniGraph())
const everything = new Set([...index.graph.nodes.map((n) => n.id), ...index.graph.edges.map((e) => e.id)])
const answer = (overrides: Partial<Answer> = {}): Answer => ({
  summary: 's',
  segments: [{ text: 't', refs: ['type.Impl', 'e.impl-gw'] }],
  highlights: [{ ref: 'type.Impl', role: 'subject' }],
  visuals: [],
  followUps: [{ question: 'q', focusRef: 'type.GW' }],
  ...overrides,
})

describe('validateAnswer', () => {
  it('accepts an answer whose references all exist', () => {
    expect(validateAnswer(answer(), index, everything)).toEqual({ answer: answer(), issues: [] })
  })

  it('removes unknown references and reports each of them', () => {
    const { answer: cleaned, issues } = validateAnswer(
      answer({
        segments: [{ text: 't', refs: ['type.Impl', 'type.Ghost'] }],
        highlights: [{ ref: 'e.ghost', role: 'path' }],
        followUps: [{ question: 'q', focusRef: 'type.Ghost' }],
      }),
      index,
      everything,
    )

    expect(cleaned.segments[0]?.refs).toEqual(['type.Impl'])
    expect(cleaned.highlights).toEqual([])
    expect(cleaned.followUps[0]?.focusRef).toBeNull()
    expect(issues).toEqual([
      { kind: 'unknownRef', where: 'segment', ref: 'type.Ghost' },
      { kind: 'unknownRef', where: 'highlight', ref: 'e.ghost' },
      { kind: 'unknownRef', where: 'followUp', ref: 'type.Ghost' },
    ])
  })

  it('drops a visual entirely when any of its references is unknown', () => {
    const { answer: cleaned, issues } = validateAnswer(
      answer({
        visuals: [
          { type: 'trace', label: 'ok', edgeIds: ['c.load-exec', 'c.exec-fetch'] },
          { type: 'trace', label: 'broken', edgeIds: ['c.load-exec', 'type.Impl'] },
          { type: 'whatIfRemove', nodeIds: ['type.Repo', 'type.Ghost'] },
        ],
      }),
      index,
      everything,
    )

    expect(cleaned.visuals).toEqual([{ type: 'trace', label: 'ok', edgeIds: ['c.load-exec', 'c.exec-fetch'] }])
    expect(issues).toEqual([
      { kind: 'visualDropped', visual: 'trace', unknownRefs: ['type.Impl'] },
      { kind: 'visualDropped', visual: 'whatIfRemove', unknownRefs: ['type.Ghost'] },
    ])
  })

  it('treats an existing id that the context never showed as unknown', () => {
    const shown = new Set(['type.Impl', 'e.impl-gw', 'type.GW'])
    const { answer: cleaned, issues } = validateAnswer(
      answer({ highlights: [{ ref: 'type.View', role: 'related' }], visuals: [{ type: 'whatIfRemove', nodeIds: ['type.UC'] }] }),
      index,
      shown,
    )

    expect(cleaned.highlights).toEqual([])
    expect(cleaned.visuals).toEqual([])
    expect(issues).toEqual([
      { kind: 'unknownRef', where: 'highlight', ref: 'type.View' },
      { kind: 'visualDropped', visual: 'whatIfRemove', unknownRefs: ['type.UC'] },
    ])
  })

  it('drops a visual that names nothing', () => {
    const { answer: cleaned } = validateAnswer(answer({ visuals: [{ type: 'whatIfRemove', nodeIds: [] }] }), index, everything)
    expect(cleaned.visuals).toEqual([])
  })

  it('rejects output that does not match the answer shape', () => {
    expect(() => validateAnswer({ summary: 1 }, index, everything)).toThrow(AnswerFormatError)
    expect(() => validateAnswer({ ...answer(), visuals: [{ type: 'runScript', code: 'rm -rf /' }] }, index, everything)).toThrow(AnswerFormatError)
  })
})
