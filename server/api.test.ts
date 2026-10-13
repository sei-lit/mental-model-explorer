import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../src/core/model/graphIndex'
import type { Answer } from '../src/core/understanding/answer'
import type { Responder } from '../src/core/understanding/responder'
import { miniGraph } from '../src/core/testing/miniGraph'
import { BadRequestError, handleAsk } from './api'
import { ClaudeCliError, parseCliResult } from './claudeCliResponder'

const index = new GraphIndex(miniGraph())

class FixedResponder implements Responder {
  readonly kind = 'claude-cli' as const
  received: unknown[] = []
  constructor(private readonly answer: unknown) {}
  async ask(context: unknown) {
    this.received.push(context)
    return this.answer
  }
}

const answerWithGhost: Answer = {
  summary: 's',
  segments: [{ text: 't', refs: ['type.Impl', 'type.Ghost'] }],
  highlights: [],
  visuals: [],
  followUps: [],
}

describe('handleAsk', () => {
  it('returns the validated answer with issues and the responder that produced it', async () => {
    const result = await handleAsk(index, new FixedResponder(answerWithGhost), { context: { question: 'なぜ？' } })

    expect(result.source).toBe('claude-cli')
    expect(result.answer.segments[0]?.refs).toEqual(['type.Impl'])
    expect(result.issues).toEqual([{ kind: 'unknownRef', where: 'segment', ref: 'type.Ghost' }])
  })

  it('rejects a request without a question before calling the responder', async () => {
    const responder = new FixedResponder(answerWithGhost)

    await expect(handleAsk(index, responder, { context: { question: '  ' } })).rejects.toThrow(BadRequestError)
    await expect(handleAsk(index, responder, {})).rejects.toThrow(BadRequestError)
    expect(responder.received).toEqual([])
  })
})

describe('parseCliResult', () => {
  it('returns the structured output of a successful run', () => {
    expect(parseCliResult(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { a: 1 } }))).toEqual({ a: 1 })
  })

  it('reports CLI failures such as not being logged in', () => {
    expect(() => parseCliResult(JSON.stringify({ subtype: 'success', is_error: true, result: 'Not logged in' }))).toThrow(/Not logged in/)
    expect(() => parseCliResult(JSON.stringify({ subtype: 'error_max_turns', is_error: false }))).toThrow(ClaudeCliError)
  })

  it('reports output that is not JSON or lacks structured output', () => {
    expect(() => parseCliResult('oops')).toThrow(ClaudeCliError)
    expect(() => parseCliResult(JSON.stringify({ subtype: 'success', is_error: false, result: 'text' }))).toThrow(/structured_output/)
  })
})
