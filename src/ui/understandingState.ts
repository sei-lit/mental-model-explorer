import type { Viewpoint } from '../core/exploration/state'
import type { QuestionContext } from '../core/understanding/context'
import type { AskResult } from '../core/understanding/responder'
import type { QuestionTarget } from '../core/understanding/target'
import type { WhatIfMode } from './overlay'

export interface AnswerCard {
  id: string
  question: string
  target: QuestionTarget
  targetLabel: string
  /** Where the user was when asking, so the card can bring that screen back later. */
  viewpoint: Viewpoint
  /** Set when asked on a module page: the server attaches that module's source, and restoring reopens the page. */
  moduleId: string | null
  context: QuestionContext
  reply: Reply
}

export type Reply = { status: 'pending' } | { status: 'done'; result: AskResult } | { status: 'error'; error: string }

export interface UnderstandingState {
  /** Newest first. */
  cards: AnswerCard[]
  activeCardId: string | null
  hoverRefs: string[] | null
  whatIfMode: WhatIfMode
  /** The card whose removal estimate is drawn; null while none is. */
  whatIfCardId: string | null
}

export type UnderstandingAction =
  | { type: 'asked'; card: AnswerCard }
  | { type: 'answered'; id: string; result: AskResult }
  | { type: 'failed'; id: string; error: string }
  | { type: 'retry'; id: string }
  | { type: 'activate'; id: string | null }
  | { type: 'hover'; refs: string[] | null }
  | { type: 'showWhatIf'; id: string; mode: WhatIfMode }
  | { type: 'hideWhatIf' }
  | { type: 'setWhatIfMode'; mode: WhatIfMode }

export const initialUnderstanding: UnderstandingState = {
  cards: [],
  activeCardId: null,
  hoverRefs: null,
  whatIfMode: 'after',
  whatIfCardId: null,
}

export function understandingReducer(state: UnderstandingState, action: UnderstandingAction): UnderstandingState {
  switch (action.type) {
    case 'asked':
      return { ...state, cards: [action.card, ...state.cards], activeCardId: action.card.id, whatIfCardId: null }
    case 'answered':
      return updateCard(state, action.id, { status: 'done', result: action.result })
    case 'failed':
      return updateCard(state, action.id, { status: 'error', error: action.error })
    case 'retry':
      return updateCard(state, action.id, { status: 'pending' })
    case 'activate':
      return { ...state, activeCardId: action.id, whatIfCardId: action.id === state.whatIfCardId ? action.id : null }
    case 'hover':
      return { ...state, hoverRefs: action.refs }
    case 'showWhatIf':
      return { ...state, activeCardId: action.id, whatIfCardId: action.id, whatIfMode: action.mode }
    case 'hideWhatIf':
      return { ...state, whatIfCardId: null }
    case 'setWhatIfMode':
      return { ...state, whatIfMode: action.mode }
  }
}

/** Results are matched by card id, so answers that arrive out of order never touch another card. */
function updateCard(state: UnderstandingState, id: string, reply: Reply): UnderstandingState {
  return { ...state, cards: state.cards.map((card) => (card.id === id ? { ...card, reply } : card)) }
}

export function resultOf(card: AnswerCard | null | undefined): AskResult | null {
  return card?.reply.status === 'done' ? card.reply.result : null
}

/**
 * The answer a follow-up like "それはなぜ？" refers to: the one on screen if it is answered, otherwise
 * the latest answered one.
 */
export function previousTurn(cards: readonly AnswerCard[], activeCardId: string | null): { question: string; summary: string } | null {
  const active = cards.find((card) => card.id === activeCardId)
  for (const card of active ? [active, ...cards] : cards) {
    const result = resultOf(card)
    if (result) return { question: card.question, summary: result.answer.summary }
  }
  return null
}
