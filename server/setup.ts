import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectGraph } from '../src/core/model/graph'
import { GraphIndex } from '../src/core/model/graphIndex'
import { MockBriefGenerator } from '../src/core/understanding/briefGenerator'
import type { ReadSource } from '../src/core/understanding/dossier'
import { MockResponder } from '../src/core/understanding/mockResponder'
import type { Responder } from '../src/core/understanding/responder'
import type { ProjectSource } from '../src/data/projectSource'
import { bookShelfSource } from '../src/data/sample/bookShelf'
import type { ApiOptions } from './api'
import { loadChanges, type ChangeRequest } from './changes/loadChanges'
import { ClaudeCliResponder, isCommandAvailable } from './claudeCliResponder'
import { ClaudeCliBriefGenerator, defaultCacheDir, ModuleBriefService } from './moduleBriefs'
import { RepositoryProjectSource } from './sources/repositorySource'

export interface ServerSettings {
  forceMock: boolean
  /** Root of a repository with a Kotlin Multiplatform build and/or Swift packages; null opens the bundled sample. */
  projectPath: string | null
  /** A pull request or base ref whose diff is laid over the project. */
  changes: ChangeRequest | null
  claudeCommand: string
  model: string
  timeoutMs: number
  /** Generating a module brief reads the whole module, so it gets far longer than a question. */
  briefTimeoutMs: number
}

export const defaultSettings: ServerSettings = {
  forceMock: false,
  projectPath: null,
  changes: null,
  claudeCommand: 'claude',
  // Sonnet keeps answers interactive (a few seconds); pass --model opus for deeper answers.
  model: 'sonnet',
  timeoutMs: 120_000,
  briefTimeoutMs: 300_000,
}

export interface PreparedApi {
  options: ApiOptions
  /** Why the mock is used, when it is. */
  mockReason: string | null
}

export async function prepareApi(settings: ServerSettings): Promise<PreparedApi> {
  const loaded = await projectSource(settings.projectPath).load()
  const graph = settings.changes ? { ...loaded, changes: await changesOf(settings.projectPath, settings.changes, loaded) } : loaded
  const index = new GraphIndex(graph)
  const readSource = sourceReader(settings.projectPath)
  // The sample's briefs are cheap mocks and its code is not on disk; only real projects are cached.
  const cacheDir = settings.projectPath === null ? null : defaultCacheDir()
  const mock = (reason: string): PreparedApi => ({
    options: { graph, responder: new MockResponder(index), briefs: new ModuleBriefService(index, readSource, new MockBriefGenerator(), null, null), model: null },
    mockReason: reason,
  })

  if (settings.forceMock) return mock('--mock が指定されました')
  if (!(await isCommandAvailable(settings.claudeCommand))) return mock(`${settings.claudeCommand} コマンドが見つかりません`)
  const responder: Responder = new ClaudeCliResponder({ command: settings.claudeCommand, model: settings.model, timeoutMs: settings.timeoutMs })
  const generator = new ClaudeCliBriefGenerator({ command: settings.claudeCommand, model: settings.model, timeoutMs: settings.briefTimeoutMs })
  return { options: { graph, responder, briefs: new ModuleBriefService(index, readSource, generator, settings.model, cacheDir), model: settings.model }, mockReason: null }
}

function sourceReader(projectPath: string | null): ReadSource {
  if (projectPath === null) return () => null
  return (path) => {
    try {
      return readFileSync(join(projectPath, path), 'utf8')
    } catch {
      return null
    }
  }
}

function changesOf(projectPath: string | null, request: ChangeRequest, graph: ProjectGraph) {
  if (projectPath === null) throw new Error('--pr / --diff は --project と一緒に指定してください。')
  return loadChanges(projectPath, request, graph)
}

function projectSource(projectPath: string | null): ProjectSource {
  return projectPath === null ? bookShelfSource : new RepositoryProjectSource(projectPath)
}
