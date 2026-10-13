import type { ProjectGraph } from '../../core/model/graph'
import type { QuestionContext } from '../../core/understanding/context'
import type { ModuleBriefResult } from '../../core/understanding/moduleBrief'
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

/** With a module id the server attaches that module's brief and source, which only it can read. */
export async function ask(context: QuestionContext, moduleId: string | null): Promise<AskResult> {
  const response = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(moduleId === null ? { context } : { context, moduleId }),
  })
  return readJson<AskResult>(response)
}

export function fetchModuleBrief(moduleId: string): Promise<ModuleBriefResult> {
  return getJson<ModuleBriefResult>(`/api/module-brief?id=${encodeURIComponent(moduleId)}`)
}

async function getJson<T>(url: string): Promise<T> {
  return readJson<T>(await fetch(url))
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  throw new Error(body?.error ?? `リクエストに失敗しました (${response.status})`)
}
