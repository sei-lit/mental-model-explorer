import { GraphIndex } from '../src/core/model/graphIndex'
import { MockResponder } from '../src/core/understanding/mockResponder'
import type { Responder } from '../src/core/understanding/responder'
import type { ProjectSource } from '../src/data/projectSource'
import { bookShelfSource } from '../src/data/sample/bookShelf'
import type { ApiOptions } from './api'
import { ClaudeCliResponder, isCommandAvailable } from './claudeCliResponder'
import { RepositoryProjectSource } from './sources/repositorySource'

export interface ServerSettings {
  forceMock: boolean
  /** Root of a repository with a Kotlin Multiplatform build and/or Swift packages; null opens the bundled sample. */
  projectPath: string | null
  claudeCommand: string
  model: string
  timeoutMs: number
}

export const defaultSettings: ServerSettings = {
  forceMock: false,
  projectPath: null,
  claudeCommand: 'claude',
  // Sonnet keeps answers interactive (a few seconds); pass --model opus for deeper answers.
  model: 'sonnet',
  timeoutMs: 120_000,
}

export interface PreparedApi {
  options: ApiOptions
  /** Why the mock is used, when it is. */
  mockReason: string | null
}

export async function prepareApi(settings: ServerSettings): Promise<PreparedApi> {
  const graph = await projectSource(settings.projectPath).load()
  const index = new GraphIndex(graph)
  const mock = (reason: string): PreparedApi => ({ options: { graph, responder: new MockResponder(index), model: null }, mockReason: reason })

  if (settings.forceMock) return mock('--mock が指定されました')
  if (!(await isCommandAvailable(settings.claudeCommand))) return mock(`${settings.claudeCommand} コマンドが見つかりません`)
  const responder: Responder = new ClaudeCliResponder({ command: settings.claudeCommand, model: settings.model, timeoutMs: settings.timeoutMs })
  return { options: { graph, responder, model: settings.model }, mockReason: null }
}

function projectSource(projectPath: string | null): ProjectSource {
  return projectPath === null ? bookShelfSource : new RepositoryProjectSource(projectPath)
}
