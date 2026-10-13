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
  context: QuestionContext
  status: 'pending' | 'done' | 'error'
  result?: AskResult
  error?: string
}

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
      return updateCard(state, action.id, { status: 'done', result: action.result, error: undefined })
    case 'failed':
      return updateCard(state, action.id, { status: 'error', error: action.error })
    case 'retry':
      return updateCard(state, action.id, { status: 'pending', error: undefined })
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
function updateCard(state: UnderstandingState, id: string, patch: Partial<AnswerCard>): UnderstandingState {
  return { ...state, cards: state.cards.map((card) => (card.id === id ? { ...card, ...patch } : card)) }
}

export function lastDoneCard(cards: readonly AnswerCard[]): AnswerCard | undefined {
  return cards.find((card) => card.status === 'done')
}
