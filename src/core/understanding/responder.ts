import type { QuestionContext } from './context'
import type { AnswerIssue, Answer } from './answer'

export type ResponderKind = 'claude-cli' | 'mock'

/** Produces an unvalidated answer for a context. Callers must pass the result through validateAnswer. */
export interface Responder {
  readonly kind: ResponderKind
  ask(context: QuestionContext): Promise<unknown>
}

export interface AskResult {
  answer: Answer
  issues: AnswerIssue[]
  source: ResponderKind
}
