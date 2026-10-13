import type { ProjectGraph } from '../../core/model/graph'
import type { QuestionContext } from '../../core/understanding/context'
import type { AskResult, ResponderKind } from '../../core/understanding/responder'
import type { ProjectSource } from '../../data/projectSource'

export interface ClientConfig {
  responder: ResponderKind
  model: string | null
}

export class HttpProjectSource implements ProjectSource {
  async load(): Promise<ProjectGraph> {
    return getJson<ProjectGraph>('/api/project')
  }
}

export function fetchConfig(): Promise<ClientConfig> {
  return getJson<ClientConfig>('/api/config')
}

export async function ask(context: QuestionContext): Promise<AskResult> {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context }),
  })
  return readJson<AskResult>(response)
}

async function getJson<T>(url: string): Promise<T> {
  return readJson<T>(await fetch(url))
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  throw new Error(body?.error ?? `リクエストに失敗しました (${response.status})`)
}
