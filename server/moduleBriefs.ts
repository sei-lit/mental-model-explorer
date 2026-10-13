import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GraphIndex } from '../src/core/model/graphIndex'
import type { BriefGenerator } from '../src/core/understanding/briefGenerator'
import { buildDossier, manifestOf, renderDossier, type DossierFile, type DossierManifest, type ModuleDossier, type ReadSource } from '../src/core/understanding/dossier'
import { BRIEF_PROMPT_VERSION, briefJsonSchema, briefSystemPrompt, validateBrief, type ValidatedBrief } from '../src/core/understanding/moduleBrief'
import type { ResponderKind } from '../src/core/understanding/responder'
import { isolatedWorkdir, runStructured, type ClaudeCliOptions } from './claudeCliResponder'

export interface ModuleBriefResult extends ValidatedBrief {
  moduleId: string
  /** Identifies the dossier, prompt and model the brief was generated from. Shown with the context preview. */
  hash: string
  manifest: DossierManifest
  /** The files the brief cites, so the page can show the code behind each statement. */
  files: DossierFile[]
  generatedBy: ResponderKind
  model: string | null
  cached: boolean
}

export class NotAModuleError extends Error {}

/**
 * Generates and caches the brief of each module. Generation reads a whole module and takes tens of
 * seconds, so a brief is generated once per dossier, prompt and model and then read from disk.
 */
export class ModuleBriefService {
  private readonly dossiers = new Map<string, ModuleDossier>()
  private readonly inFlight = new Map<string, Promise<ModuleBriefResult>>()
  // Without a disk cache the brief still has to outlive the request: questions read it back.
  private readonly memory = new Map<string, unknown>()

  constructor(
    private readonly index: GraphIndex,
    private readonly readSource: ReadSource,
    private readonly generator: BriefGenerator,
    private readonly model: string | null,
    /** Null disables the disk cache (the bundled sample and tests). */
    private readonly cacheDir: string | null,
  ) {}

  dossier(moduleId: string): ModuleDossier {
    if (!this.index.hasNode(moduleId) || this.index.node(moduleId).kind !== 'module') throw new NotAModuleError(`${moduleId} はモジュールではありません`)
    let dossier = this.dossiers.get(moduleId)
    if (!dossier) {
      dossier = buildDossier(this.index, moduleId, this.readSource)
      this.dossiers.set(moduleId, dossier)
    }
    return dossier
  }

  brief(moduleId: string): Promise<ModuleBriefResult> {
    const running = this.inFlight.get(moduleId)
    if (running) return running
    const promise = this.load(moduleId).finally(() => this.inFlight.delete(moduleId))
    this.inFlight.set(moduleId, promise)
    return promise
  }

  /** A brief already on disk, without generating one. Questions about a module need the brief the page shows. */
  cachedBrief(moduleId: string): ModuleBriefResult | null {
    const dossier = this.dossier(moduleId)
    const hash = this.hashOf(dossier)
    const raw = this.readCache(hash)
    return raw === null ? null : this.result(dossier, hash, raw, true)
  }

  private async load(moduleId: string): Promise<ModuleBriefResult> {
    const cached = this.cachedBrief(moduleId)
    if (cached) return cached
    const dossier = this.dossier(moduleId)
    const hash = this.hashOf(dossier)
    const raw = await this.generator.generate(dossier)
    // Validate before caching so a malformed output is regenerated next time instead of served forever.
    const result = this.result(dossier, hash, raw, false)
    this.writeCache(hash, raw)
    return result
  }

  private result(dossier: ModuleDossier, hash: string, raw: unknown, cached: boolean): ModuleBriefResult {
    return {
      ...validateBrief(raw, dossier),
      moduleId: dossier.moduleId,
      hash,
      manifest: manifestOf(dossier),
      files: dossier.files,
      generatedBy: this.generator.kind,
      model: this.model,
      cached,
    }
  }

  private hashOf(dossier: ModuleDossier): string {
    return createHash('sha256')
      .update(JSON.stringify({ version: BRIEF_PROMPT_VERSION, prompt: briefSystemPrompt, schema: briefJsonSchema, generator: this.generator.kind, model: this.model }))
      .update(renderDossier(dossier))
      .digest('hex')
      .slice(0, 16)
  }

  private readCache(hash: string): unknown | null {
    if (this.cacheDir === null) return this.memory.get(hash) ?? null
    const file = join(this.cacheDir, `${hash}.json`)
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }

  private writeCache(hash: string, raw: unknown): void {
    if (this.cacheDir === null) {
      this.memory.set(hash, raw)
      return
    }
    // The brief quotes the user's code, so only the user may read it. Written through a temporary file
    // so a concurrent reader never sees half a file.
    mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 })
    const file = join(this.cacheDir, `${hash}.json`)
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(raw), { mode: 0o600 })
    renameSync(temporary, file)
  }
}

export function defaultCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'mental-model-explorer', 'briefs')
}

/** Generates through the user's claude CLI; reading a whole module takes far longer than answering a question. */
export class ClaudeCliBriefGenerator implements BriefGenerator {
  readonly kind = 'claude-cli' as const
  private readonly workdir = isolatedWorkdir()

  constructor(private readonly options: ClaudeCliOptions) {}

  generate(dossier: ModuleDossier): Promise<unknown> {
    return runStructured(this.options, {
      schema: briefJsonSchema,
      systemPrompt: briefSystemPrompt,
      input: renderDossier(dossier),
      cwd: this.workdir,
      timeoutMs: this.options.timeoutMs,
    })
  }
}
