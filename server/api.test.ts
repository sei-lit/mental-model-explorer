import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../src/core/model/graphIndex'
import type { Answer } from '../src/core/understanding/answer'
import type { Responder } from '../src/core/understanding/responder'
import { miniGraph } from '../src/core/testing/miniGraph'
import { createExplorationReducer, initialExploration } from '../src/core/exploration/state'
import { buildQuestionContext } from '../src/core/understanding/context'
import { BadRequestError, handleAsk, isTrustedRequest } from './api'
import { ClaudeCliError, parseCliResult } from './claudeCliResponder'
import { MockBriefGenerator } from '../src/core/understanding/briefGenerator'
import { ModuleBriefService } from './moduleBriefs'

const index = new GraphIndex(miniGraph())
const exploration = createExplorationReducer(index)(initialExploration(index), { type: 'select', selection: { kind: 'node', nodeId: 'pkg.Data' } })
const contextAsking = (question: string) => buildQuestionContext({ index, exploration, target: { kind: 'node', nodeId: 'pkg.Data' }, question })
const newBriefs = () => new ModuleBriefService(index, () => null, new MockBriefGenerator(), null, null)

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
  segments: [{ text: 't', refs: ['pkg.Data', 'type.Ghost', 'method.VM.load'] }],
  highlights: [],
  visuals: [],
  followUps: [],
}

describe('handleAsk', () => {
  it('returns the validated answer with issues and the responder that produced it', async () => {
    const result = await handleAsk(index, new FixedResponder(answerWithGhost), newBriefs(), { context: contextAsking('なぜ？') })

    expect(result.source).toBe('claude-cli')
    expect(result.answer.segments[0]?.refs).toEqual(['pkg.Data'])
    // method.VM.load exists in the graph but was not part of what the user was looking at.
    expect(result.issues).toEqual([
      { kind: 'unknownRef', where: 'segment', ref: 'type.Ghost' },
      { kind: 'unknownRef', where: 'segment', ref: 'method.VM.load' },
    ])
  })

  it('rejects a request without a question before calling the responder', async () => {
    const responder = new FixedResponder(answerWithGhost)

    await expect(handleAsk(index, responder, newBriefs(), { context: contextAsking('  ') })).rejects.toThrow(BadRequestError)
    await expect(handleAsk(index, responder, newBriefs(), { context: { question: 'なぜ？' } })).rejects.toThrow(BadRequestError)
    await expect(handleAsk(index, responder, newBriefs(), {})).rejects.toThrow(BadRequestError)
    expect(responder.received).toEqual([])
  })

  it('refuses a module question until the brief the page shows exists', async () => {
    await expect(handleAsk(index, new FixedResponder(answerWithGhost), newBriefs(), { context: contextAsking('何をする？'), moduleId: 'mod.Screen' })).rejects.toThrow(
      /要約がまだありません/,
    )
  })

  it('attaches the module dossier on the server and lets the answer cite its declarations', async () => {
    const briefs = newBriefs()
    await briefs.brief('mod.Screen')
    const responder = new FixedResponder(answerWithGhost)
    const forged = { ...contextAsking('何をする？'), module: { citableIds: ['type.Ghost'] } }

    const result = await handleAsk(index, responder, briefs, { context: forged, moduleId: 'mod.Screen' })

    const sent = responder.received[0] as { module: { moduleId: string; dossier: string } }
    expect(sent.module.moduleId).toBe('mod.Screen')
    expect(sent.module.dossier).toContain('method.VM.load')
    // Cited from the dossier now; the id the browser tried to add is still unknown.
    expect(result.answer.segments[0]?.refs).toEqual(['pkg.Data', 'method.VM.load'])
    expect(result.issues).toEqual([{ kind: 'unknownRef', where: 'segment', ref: 'type.Ghost' }])
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

describe('isTrustedRequest', () => {
  const json = { 'content-type': 'application/json' }

  it('accepts same-origin requests to a loopback host', () => {
    expect(isTrustedRequest('POST', { host: '127.0.0.1:5178', origin: 'http://127.0.0.1:5178', ...json })).toBe(true)
    expect(isTrustedRequest('GET', { host: 'localhost:5173' })).toBe(true)
  })

  it('rejects requests sent from another site', () => {
    expect(isTrustedRequest('POST', { host: '127.0.0.1:5178', origin: 'https://example.com', ...json })).toBe(false)
  })

  it('rejects malformed host or origin headers instead of throwing', () => {
    expect(isTrustedRequest('GET', { host: 'a b' })).toBe(false)
    expect(isTrustedRequest('GET', { host: '127.0.0.1:5178', origin: 'null' })).toBe(false)
  })

  it('rejects a rebound host name even when it resolves to loopback', () => {
    expect(isTrustedRequest('GET', { host: 'attacker.example:5178' })).toBe(false)
  })

  it('rejects a POST that a cross-site form could send without a preflight', () => {
    expect(isTrustedRequest('POST', { host: '127.0.0.1:5178', 'content-type': 'text/plain' })).toBe(false)
  })
})
