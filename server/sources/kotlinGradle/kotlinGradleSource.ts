import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { deriveFlows, resolveCalls, type CallSite, type EntryKind, type FunctionFacts, type TypeFacts } from '../common/callGraph'
import type { Claim, GraphEdge, GraphNode, LayerDefinition, ProjectGraph, SourceSpan } from '../../../src/core/model/graph'
import { spanOf } from '../common/spans'
import type { ProjectSource } from '../../../src/data/projectSource'
import { parseModuleDependencies } from './buildScript'
import type { KotlinCall, KotlinTypedName } from './kotlinCalls'
import { capLines, parseKotlinFile, type KotlinDeclaration, type KotlinFile, type KotlinFunction, type KotlinMember } from './kotlinParser'
import { parseSettings } from './settings'

const SOURCE_SETS = ['commonMain', 'androidMain', 'iosMain', 'jvmMain', 'main']

const GROUP_LAYERS: Record<string, string> = {
  feature: 'kmp.presentation',
  ui: 'kmp.presentation',
  access: 'kmp.presentation',
  domain: 'kmp.domain',
  data: 'kmp.data',
}

// domain:usecaseimpl is allowed to depend on data:repository by the project's CLAUDE.md, so domain may see data.
const LAYERS: LayerDefinition[] = [
  { id: 'kmp.presentation', label: 'Presentation', system: 'kmp', mayDependOn: ['kmp.presentation', 'kmp.domain'] },
  { id: 'kmp.domain', label: 'Domain', system: 'kmp', mayDependOn: ['kmp.domain', 'kmp.data'] },
  { id: 'kmp.data', label: 'Data', system: 'kmp', mayDependOn: ['kmp.data', 'kmp.domain'] },
]

interface ModuleInfo {
  path: string
  name: string
  dir: string
  group: string
}

interface TypeEntry {
  fqn: string
  declaration: KotlinDeclaration
  file: KotlinFile
  filePath: string
  module: ModuleInfo
  /** actual declarations of an expect type in other source sets; only the first declaration becomes nodes. */
  counterparts: SourceSpan[]
}

interface FunctionEntry {
  id: string
  packageName: string
  declaration: KotlinFunction
  file: KotlinFile
  filePath: string
  module: ModuleInfo
}

interface Symbols {
  types: Map<string, TypeEntry>
  functions: FunctionEntry[]
}

interface ModuleClaims {
  responsibility?: Claim
  constraint?: Claim
}

const observed = (text: string, source: string): Claim => ({ text, provenance: 'observed', source })

/** Reads a Gradle Kotlin Multiplatform repository: modules from settings.gradle.kts, types from the .kt sources. */
export class KotlinGradleProjectSource implements ProjectSource {
  constructor(private readonly rootDir: string) {}

  async load(): Promise<ProjectGraph> {
    const settings = parseSettings(readFileSync(join(this.rootDir, 'settings.gradle.kts'), 'utf8'))
    const modules = settings.modules
      .filter((path) => path !== ':tools' && !path.startsWith(':tools:'))
      .sort()
      .map((path): ModuleInfo => {
        const segments = path.split(':').filter(Boolean)
        return { path, name: segments.join(':'), dir: segments.join('/'), group: segments[0] ?? path }
      })

    const symbols = this.readSymbols(modules)
    const { types } = symbols
    const claims = this.readClaims()
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []

    nodes.push({
      id: 'project',
      kind: 'project',
      name: settings.rootProjectName ?? basename(this.rootDir),
      parentId: null,
      summary: 'Gradle Kotlin Multiplatform プロジェクト。',
    })
    for (const group of [...new Set(modules.map((module) => module.group))].sort()) {
      nodes.push({ id: `group:${group}`, kind: 'package', name: group, parentId: 'project', summary: `${group} 配下の Gradle モジュール群。`, layer: GROUP_LAYERS[group] })
    }

    for (const module of modules) {
      const moduleId = `module:${module.name}`
      const moduleClaims = claims.get(module.name)
      nodes.push({
        id: moduleId,
        kind: 'module',
        name: module.name,
        parentId: `group:${module.group}`,
        aliases: module.name.includes(':') ? [module.path, module.name.split(':').at(-1) as string] : [module.path],
        summary: moduleClaims?.responsibility?.text ?? `Gradle モジュール ${module.path}`,
        ...(moduleClaims?.responsibility ? { responsibility: moduleClaims.responsibility } : {}),
        ...(moduleClaims?.constraint ? { constraints: [moduleClaims.constraint] } : {}),
      })
      nodes.push(...this.symbolNodes(module, moduleId, symbols))
      edges.push(...this.dependencyEdges(module, modules))
    }

    edges.push(...typeEdges(types), ...functionEdges(symbols))
    const { typeFacts, functionFacts, entries } = callFacts(symbols)
    const callEdges = resolveCalls(typeFacts, functionFacts)
    edges.push(...callEdges)
    const flows = deriveFlows(callEdges, {
      entryKind: (nodeId) => entryKind(entries.get(nodeId)),
      nameOf: (nodeId) => entries.get(nodeId)?.displayName ?? nodeId,
    })
    return { rootId: 'project', layers: LAYERS, nodes, edges, flows }
  }

  private readSymbols(modules: readonly ModuleInfo[]): Symbols {
    const types = new Map<string, TypeEntry>()
    const functions: FunctionEntry[] = []
    const functionKeys = new Map<string, number>()
    const signatureKeys = new Set<string>()
    for (const module of modules) {
      for (const sourceSet of SOURCE_SETS) {
        for (const absolute of kotlinFiles(join(this.rootDir, module.dir, 'src', sourceSet, 'kotlin'))) {
          const file = parseKotlinFile(readFileSync(absolute, 'utf8'))
          const filePath = relative(this.rootDir, absolute).split(sep).join('/')
          for (const declaration of file.declarations) {
            const fqn = file.packageName ? `${file.packageName}.${declaration.name}` : declaration.name
            // expect/actual declarations share a name across source sets; the first one (commonMain) wins.
            const existing = types.get(fqn)
            if (existing) existing.counterparts.push(spanOf(filePath, declaration))
            else types.set(fqn, { fqn, declaration, file, filePath, module, counterparts: [] })
          }
          for (const declaration of file.functions) {
            const base = `fn:${file.packageName ? `${file.packageName}.` : ''}${declaration.name}`
            // Same signature in another source set is the expect/actual counterpart; a different one is an overload.
            const signature = `${base}|${declaration.signature.replace(/\b(expect|actual)\s+/g, '').replace(/\s*[{=].*$/, '')}`
            if (signatureKeys.has(signature)) continue
            signatureKeys.add(signature)
            const count = (functionKeys.get(base) ?? 0) + 1
            functionKeys.set(base, count)
            functions.push({ id: count === 1 ? base : `${base}#${count}`, packageName: file.packageName, declaration, file, filePath, module })
          }
        }
      }
    }
    return { types, functions }
  }

  private symbolNodes(module: ModuleInfo, moduleId: string, symbols: Symbols): GraphNode[] {
    const own = [...symbols.types.values()].filter((entry) => entry.module === module).sort((a, b) => a.fqn.localeCompare(b.fqn))
    const ownFunctions = symbols.functions.filter((entry) => entry.module === module).sort((a, b) => a.id.localeCompare(b.id))
    const nodes: GraphNode[] = []
    const packages = [...new Set([...own.map((entry) => entry.file.packageName), ...ownFunctions.map((entry) => entry.packageName)])].sort()
    const prefix = commonPrefix(packages.map((name) => name.split('.').filter(Boolean)))
    const namespaceIds = new Map<string, string>()
    if (packages.length > 1) {
      for (const packageName of packages) {
        const relativeName = packageName.split('.').filter(Boolean).slice(prefix.length).join('.')
        const id = `ns:${module.name}:${relativeName || '.'}`
        namespaceIds.set(packageName, id)
        nodes.push({ id, kind: 'namespace', name: relativeName || (prefix.at(-1) ?? packageName), parentId: moduleId, summary: `package ${packageName}` })
      }
    }

    for (const entry of own) {
      const { declaration, filePath } = entry
      const typeId = `type:${entry.fqn}`
      nodes.push({
        id: typeId,
        kind: 'type',
        name: declaration.name,
        parentId: namespaceIds.get(entry.file.packageName) ?? moduleId,
        flavor: declaration.flavor,
        summary: declaration.summary ?? `${declaration.flavor} ${declaration.name}`,
        ...(declaration.members.length === 0
          ? { code: { language: 'kotlin' as const, path: filePath, startLine: declaration.startLine, text: capLines(declaration.text) } }
          : {}),
        spans: [spanOf(filePath, declaration), ...entry.counterparts],
      })
      for (const { id, member, name } of memberNodes(entry)) {
        nodes.push({
          id,
          kind: member.kind,
          name,
          parentId: typeId,
          summary: member.signature,
          code: { language: 'kotlin', path: filePath, startLine: member.startLine, text: member.text },
          spans: [spanOf(filePath, member)],
        })
      }
    }
    for (const entry of ownFunctions) {
      const { declaration } = entry
      nodes.push({
        id: entry.id,
        kind: 'method',
        name: declaration.name,
        parentId: namespaceIds.get(entry.packageName) ?? moduleId,
        summary: declaration.signature,
        code: { language: 'kotlin', path: entry.filePath, startLine: declaration.startLine, text: declaration.text },
        spans: [spanOf(entry.filePath, declaration)],
      })
    }
    return nodes
  }

  private dependencyEdges(module: ModuleInfo, modules: readonly ModuleInfo[]): GraphEdge[] {
    const scriptPath = `${module.dir}/build.gradle.kts`
    const absolute = join(this.rootDir, scriptPath)
    if (!existsSync(absolute)) return []
    const byPath = new Map(modules.map((candidate) => [candidate.path, candidate]))
    const dependencies = parseModuleDependencies(readFileSync(absolute, 'utf8'), [...byPath.keys()])
    return dependencies.flatMap((dependency) => {
      const target = byPath.get(dependency.target)
      if (!target || target === module) return []
      return [
        {
          id: `dep:${module.name}->${target.name}`,
          source: `module:${module.name}`,
          target: `module:${target.name}`,
          relation: 'depends_on' as const,
          evidence: observed(dependency.text, `${scriptPath}:${dependency.line}`),
        },
      ]
    })
  }

  /** CLAUDE.md is optional; responsibilities and allowed dependencies from its tables are interpretations, not observations. */
  private readClaims(): Map<string, ModuleClaims> {
    const claims = new Map<string, ModuleClaims>()
    const path = join(this.rootDir, 'CLAUDE.md')
    if (!existsSync(path)) return claims

    let heading = ''
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const headingMatch = /^#{1,6}\s+(.*)$/.exec(line)
      if (headingMatch) {
        heading = headingMatch[1] ?? ''
        continue
      }
      if (!line.trim().startsWith('|')) continue
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      const name = /^`:?([\w:-]+)`$/.exec(cells[0] ?? '')?.[1]
      const text = cells[1]?.replace(/`/g, '')
      if (!name || !text) continue
      const entry = claims.get(name) ?? {}
      if (heading.includes('モジュール構成') && !entry.responsibility) {
        entry.responsibility = { text, provenance: 'inferred', source: 'CLAUDE.md' }
      } else if (heading.includes('依存の向き') && !entry.constraint) {
        entry.constraint = { text: `依存してよい: ${text}`, provenance: 'inferred', source: 'CLAUDE.md 依存の向き' }
      }
      claims.set(name, entry)
    }
    return claims
  }
}


function memberNodes(entry: TypeEntry): { id: string; name: string; member: KotlinMember }[] {
  const seen = new Map<string, number>()
  return entry.declaration.members.map((member) => {
    const name = member.companion ? `Companion.${member.name}` : member.name
    const base = `${member.kind === 'method' ? 'method' : 'prop'}:${entry.fqn}.${name}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return { id: count === 1 ? base : `${base}#${count}`, name, member }
  })
}

function kotlinFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name !== 'build') found.push(...kotlinFiles(join(dir, entry.name)))
    } else if (entry.name.endsWith('.kt')) {
      found.push(join(dir, entry.name))
    }
  }
  return found
}

function commonPrefix(lists: readonly string[][]): string[] {
  const first = lists[0]
  if (!first) return []
  let length = first.length
  for (const list of lists) {
    let shared = 0
    while (shared < length && list[shared] === first[shared]) shared++
    length = shared
  }
  return first.slice(0, length)
}

/** Unresolvable or ambiguous names yield no edge: a missing edge is better than a false one. */
function typeEdges(types: Map<string, TypeEntry>): GraphEdge[] {
  const edges: GraphEdge[] = []
  for (const entry of [...types.values()].sort((a, b) => a.fqn.localeCompare(b.fqn))) {
    const { declaration, file, filePath } = entry
    const resolve = nameResolver(file, types)
    const headerLine = declaration.text.split('\n')[declaration.line - declaration.startLine]?.trim() ?? declaration.name
    const linked = new Set<string>([entry.fqn])

    for (const supertype of declaration.supertypes) {
      const target = supertype.includes('.') ? (types.has(supertype) ? supertype : null) : resolve(supertype)
      if (!target || linked.has(target)) continue
      linked.add(target)
      edges.push({
        id: `impl:${entry.fqn}->${target}`,
        source: `type:${entry.fqn}`,
        target: `type:${target}`,
        relation: 'implements',
        evidence: observed(headerLine, `${filePath}:${declaration.line}`),
      })
    }

    for (const reference of declaration.references) {
      const target = resolve(reference.name)
      if (!target || linked.has(target)) continue
      linked.add(target)
      edges.push({
        id: `ref:${entry.fqn}->${target}`,
        source: `type:${entry.fqn}`,
        target: `type:${target}`,
        relation: 'depends_on',
        evidence: observed(`${reference.name} を参照`, `${filePath}:${reference.line}`),
      })
    }
  }
  return edges
}

function functionEdges(symbols: Symbols): GraphEdge[] {
  const edges: GraphEdge[] = []
  for (const entry of [...symbols.functions].sort((a, b) => a.id.localeCompare(b.id))) {
    const resolve = nameResolver(entry.file, symbols.types)
    const linked = new Set<string>()
    for (const reference of entry.declaration.references) {
      const target = resolve(reference.name)
      if (!target || linked.has(target)) continue
      linked.add(target)
      edges.push({
        id: `ref:${entry.id}->${target}`,
        source: entry.id,
        target: `type:${target}`,
        relation: 'depends_on',
        evidence: observed(`${reference.name} を参照`, `${entry.filePath}:${reference.line}`),
      })
    }
  }
  return edges
}

function nameResolver(file: KotlinFile, types: Map<string, TypeEntry>): (name: string) => string | null {
  const explicit = new Map<string, string>()
  const wildcardPackages: string[] = []
  for (const entry of file.imports) {
    if (entry.wildcard) wildcardPackages.push(entry.path)
    else explicit.set(entry.alias ?? (entry.path.split('.').at(-1) as string), entry.path)
  }
  return (name) => {
    const imported = explicit.get(name)
    if (imported !== undefined) return types.has(imported) ? imported : null
    const samePackage = file.packageName ? `${file.packageName}.${name}` : name
    if (types.has(samePackage)) return samePackage
    const candidates = [...new Set(wildcardPackages.map((packageName) => `${packageName}.${name}`).filter((fqn) => types.has(fqn)))]
    return candidates.length === 1 ? (candidates[0] as string) : null
  }
}

interface EntryInfo {
  displayName: string
  methodName: string
  group: string
  /** Name of the owning type; null for top-level functions. */
  typeName: string | null
}

const PRESENTATION_LAYER = 'kmp.presentation'
const SCREEN_NAME = /(Screen|Route)$/
const EVENT_HANDLER_NAME = /^(on[A-Z]|handle|load|refresh|retry|reload|send|dispatch|process|submit)/
const ACCESS_ENTRY_NAMES = new Set(['invoke', 'viewModel'])

function entryKind(info: EntryInfo | undefined): EntryKind | null {
  if (!info || GROUP_LAYERS[info.group] !== PRESENTATION_LAYER) return null
  if (SCREEN_NAME.test(info.methodName) || EVENT_HANDLER_NAME.test(info.methodName)) return 'lifecycle'
  if (info.group === 'access' && info.typeName !== null && ACCESS_ENTRY_NAMES.has(info.methodName)) return 'lifecycle'
  return 'other'
}

function callFacts(symbols: Symbols): { typeFacts: TypeFacts[]; functionFacts: FunctionFacts[]; entries: Map<string, EntryInfo> } {
  const typeFacts: TypeFacts[] = []
  const functionFacts: FunctionFacts[] = []
  const entries = new Map<string, EntryInfo>()
  const typeResolvers = new Map<string, (name: string) => string | null>()
  const resolverFor = (file: KotlinFile, key: string) => {
    let resolver = typeResolvers.get(key)
    if (!resolver) {
      const resolve = nameResolver(file, symbols.types)
      resolver = (name) => {
        const fqn = resolve(name)
        return fqn === null ? null : `type:${fqn}`
      }
      typeResolvers.set(key, resolver)
    }
    return resolver
  }

  for (const entry of [...symbols.types.values()].sort((a, b) => a.fqn.localeCompare(b.fqn))) {
    const { declaration } = entry
    const typeId = `type:${entry.fqn}`
    const resolveType = resolverFor(entry.file, entry.filePath)
    const resolveFqn = nameResolver(entry.file, symbols.types)
    const propertyTypes = new Map<string, string>()
    for (const parameter of declaration.constructorParameters) propertyTypes.set(parameter.name, parameter.type)
    for (const member of declaration.members) if (member.kind === 'property' && member.type) propertyTypes.set(member.name, member.type)

    const methods = new Map<string, string[]>()
    for (const { id, member, name } of memberNodes(entry)) {
      if (member.kind !== 'method') continue
      methods.set(member.name, [...(methods.get(member.name) ?? []), id])
      entries.set(id, { displayName: `${declaration.name}.${name}`, methodName: member.name, group: entry.module.group, typeName: declaration.name })
      functionFacts.push({
        nodeId: id,
        ownerTypeId: typeId,
        path: entry.filePath,
        localTypes: typedNameMap(member.typedNames),
        calls: member.calls.map((call) => callSite(call)),
        resolveType,
      })
    }
    const supertypeIds = declaration.supertypes.flatMap((supertype) => {
      const target = supertype.includes('.') ? (symbols.types.has(supertype) ? supertype : null) : resolveFqn(supertype)
      return target === null ? [] : [`type:${target}`]
    })
    typeFacts.push({ id: typeId, isAbstract: declaration.isAbstract, propertyTypes, methods, supertypeIds, resolveType })
  }

  for (const entry of symbols.functions) {
    entries.set(entry.id, { displayName: entry.declaration.name, methodName: entry.declaration.name, group: entry.module.group, typeName: null })
    functionFacts.push({
      nodeId: entry.id,
      ownerTypeId: null,
      path: entry.filePath,
      localTypes: typedNameMap(entry.declaration.typedNames),
      calls: entry.declaration.calls.map((call) => callSite(call)),
      resolveType: resolverFor(entry.file, entry.filePath),
    })
  }
  return { typeFacts: typeFacts, functionFacts: withInvokeCalls(functionFacts, typeFacts), entries }
}

const typedNameMap = (names: readonly KotlinTypedName[]): Map<string, string> => new Map(names.map((typed) => [typed.name, typed.type]))

const callSite = (call: KotlinCall): CallSite => ({ receiver: call.receiver, method: call.method, line: call.line, text: call.text })

/**
 * `useCase(params)` calls `invoke` when `useCase` is a parameter, local or property and not a function
 * of the owner. Without the type information that decides it, the call stays a bare call.
 */
function withInvokeCalls(functions: readonly FunctionFacts[], types: readonly TypeFacts[]): FunctionFacts[] {
  const typesById = new Map(types.map((type) => [type.id, type]))
  return functions.map((fn) => {
    const owner = fn.ownerTypeId ? typesById.get(fn.ownerTypeId) : undefined
    const calls = fn.calls.map((call): CallSite => {
      if (call.receiver !== null) return call
      const typed = fn.localTypes.has(call.method) || (owner?.propertyTypes.has(call.method) ?? false)
      if (!typed || owner?.methods.has(call.method)) return call
      return { ...call, receiver: call.method, method: 'invoke' }
    })
    return { ...fn, calls }
  })
}
