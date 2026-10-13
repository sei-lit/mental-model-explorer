import { describe, expect, it } from 'vitest'
import type { AskResult } from '../core/understanding/responder'
import { initialUnderstanding, previousTurn, understandingReducer, type AnswerCard, type UnderstandingAction } from './understandingState'

const card = (id: string, question: string): AnswerCard => ({
  id,
  question,
  target: { kind: 'view' },
  targetLabel: '表示中の画面全体',
  viewpoint: { scopeId: 'project', perspective: 'structure', flowId: null, selection: { kind: 'none' } },
  context: {} as AnswerCard['context'],
  reply: { status: 'pending' },
})

const result = (summary: string): AskResult => ({
  answer: { summary, segments: [], highlights: [], visuals: [], followUps: [] },
  issues: [],
  source: 'mock',
})

const run = (...actions: UnderstandingAction[]) => actions.reduce(understandingReducer, initialUnderstanding)

describe('understandingReducer', () => {
  it('lists the newest question first and makes it the active one', () => {
    const state = run({ type: 'asked', card: card('a', '1') }, { type: 'asked', card: card('b', '2') })

    expect(state.cards.map((c) => c.id)).toEqual(['b', 'a'])
    expect(state.activeCardId).toBe('b')
  })

  it('gives each answer to the card that asked it even when answers arrive out of order', () => {
    const state = run(
      { type: 'asked', card: card('a', '1') },
      { type: 'asked', card: card('b', '2') },
      { type: 'answered', id: 'b', result: result('B') },
      { type: 'answered', id: 'a', result: result('A') },
    )

    expect(state.cards.map((c) => [c.id, c.reply.status === 'done' && c.reply.result.answer.summary])).toEqual([
      ['b', 'B'],
      ['a', 'A'],
    ])
  })

  it('goes back to pending when a failed question is retried', () => {
    const failed = run({ type: 'asked', card: card('a', '1') }, { type: 'failed', id: 'a', error: 'timeout' })
    const retried = understandingReducer(failed, { type: 'retry', id: 'a' })

    expect(failed.cards[0]?.reply).toEqual({ status: 'error', error: 'timeout' })
    expect(retried.cards[0]?.reply).toEqual({ status: 'pending' })
  })
})

describe('previousTurn', () => {
  it('carries the latest answered question, skipping ones still waiting', () => {
    const state = run(
      { type: 'asked', card: card('a', '責務は？') },
      { type: 'answered', id: 'a', result: result('状態を持つ') },
      { type: 'asked', card: card('b', 'なぜ？') },
    )

    expect(previousTurn(state.cards)).toEqual({ question: '責務は？', summary: '状態を持つ' })
  })
})
