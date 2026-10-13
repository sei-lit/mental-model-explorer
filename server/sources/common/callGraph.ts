import type { Flow, GraphEdge } from '../../../src/core/model/graph'

/** A call written in a function body: `receiver.method(` or a bare `method(`. */
export interface CallSite {
  receiver: string | null
  method: string
  line: number
  /** The call expression as written, used as evidence. */
  text: string
}

/** Resolves a type name as written in one file to a type node id. */
export type TypeResolver = (simpleName: string) => string | null

export interface TypeFacts {
  id: string
  /** Interfaces and protocols: calls on them are dispatched to their implementations. */
  isAbstract: boolean
  /** Stored properties and constructor parameters: name → type name as written. */
  propertyTypes: ReadonlyMap<string, string>
  /** Method name → node ids (several for overloads). */
  methods: ReadonlyMap<string, readonly string[]>
  supertypeIds: readonly string[]
  /** Resolver of the file that declares the type, for its property types. */
  resolveType: TypeResolver
}

export interface FunctionFacts {
  nodeId: string
  ownerTypeId: string | null
  path: string
  /** Parameters and local variables: name → type name as written. */
  localTypes: ReadonlyMap<string, string>
  calls: readonly CallSite[]
  resolveType: TypeResolver
}

const selfReceivers = new Set(['self', 'this'])

/**
 * Turns call sites into `calls` edges. Calls are found with regular expressions and receivers are
 * typed only from declared parameter / property types, so every edge is a static-analysis
 * candidate (`inferred`), and a call whose target cannot be resolved produces no edge.
 */
export function resolveCalls(types: readonly TypeFacts[], functions: readonly FunctionFacts[]): GraphEdge[] {
  const typesById = new Map(types.map((type) => [type.id, type]))
  const edges = new Map<string, GraphEdge>()
  const add = (edge: GraphEdge) => {
    if (edge.source !== edge.target && !edges.has(edge.id)) edges.set(edge.id, edge)
  }

  for (const fn of functions) {
    const owner = fn.ownerTypeId ? typesById.get(fn.ownerTypeId) : undefined
    for (const site of fn.calls) {
      const targetType = receiverType(site, fn, owner, typesById)
      const targetId = targetType?.methods.get(site.method)?.[0]
      if (!targetType || !targetId) continue
      add({
        id: `call:${fn.nodeId}->${targetId}`,
        source: fn.nodeId,
        target: targetId,
        relation: 'calls',
        evidence: { text: site.text, provenance: 'inferred', source: `${fn.path}:${site.line}` },
      })
      if (targetType.isAbstract) {
        for (const implementation of types) {
          if (!implementation.supertypeIds.includes(targetType.id)) continue
          const implementationId = implementation.methods.get(site.method)?.[0]
          if (!implementationId) continue
          add({
            id: `dispatch:${targetId}->${implementationId}`,
            source: targetId,
            target: implementationId,
            relation: 'calls',
            evidence: { text: '動的ディスパッチ（実装への呼び出しを推定）', provenance: 'inferred' },
          })
        }
      }
    }
  }
  return [...edges.values()]
}

function receiverType(site: CallSite, fn: FunctionFacts, owner: TypeFacts | undefined, typesById: Map<string, TypeFacts>): TypeFacts | undefined {
  if (site.receiver === null || selfReceivers.has(site.receiver)) return owner
  // Only simple identifiers are typed; chains like `a.b.c(` would need full type inference.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(site.receiver)) return undefined
  const local = fn.localTypes.get(site.receiver)
  if (local) return lookup(fn.resolveType(local), typesById)
  const property = owner?.propertyTypes.get(site.receiver)
  if (property && owner) return lookup(owner.resolveType(property), typesById)
  // `TypeName.method(` calls a static / companion member.
  if (/^[A-Z]/.test(site.receiver)) return lookup(fn.resolveType(site.receiver), typesById)
  return undefined
}

function lookup(id: string | null, typesById: Map<string, TypeFacts>): TypeFacts | undefined {
  return id === null ? undefined : typesById.get(id)
}

export type EntryKind = 'lifecycle' | 'other'

export interface FlowOptions {
  /**
   * Whether a function may start a flow. `lifecycle` (UI events, lifecycle callbacks) is preferred;
   * `other` is only used when nothing in the graph calls the function, because framework calls,
   * overrides and DI-generated call sites are invisible to static analysis and would otherwise make
   * any function look like an entry point.
   */
  entryKind: (nodeId: string) => EntryKind | null
  nameOf: (nodeId: string) => string
  maxSteps?: number
  minSteps?: number
  maxFlows?: number
}

export const flowDescription = '静的解析で推定した呼び出しの流れ。解決できなかった呼び出し、DI・クロージャ・フレームワーク経由の呼び出しは含まない。'

/** Derives flows by walking calls depth-first from entry points. */
export function deriveFlows(callEdges: readonly GraphEdge[], options: FlowOptions): Flow[] {
  const maxSteps = options.maxSteps ?? 12
  const minSteps = options.minSteps ?? 3
  const maxFlows = options.maxFlows ?? 40

  const outgoing = new Map<string, GraphEdge[]>()
  const called = new Set<string>()
  for (const edge of callEdges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
    called.add(edge.target)
  }

  const roots = [...outgoing.keys()]
    .map((id) => ({ id, kind: options.entryKind(id) }))
    .filter((root): root is { id: string; kind: EntryKind } => root.kind === 'lifecycle' || (root.kind === 'other' && !called.has(root.id)))

  const candidates = roots.map((root) => ({ root, steps: walk(root.id, outgoing, maxSteps) })).filter((candidate) => candidate.steps.length >= minSteps)
  candidates.sort(
    (a, b) =>
      Number(b.root.kind === 'lifecycle') - Number(a.root.kind === 'lifecycle') ||
      b.steps.length - a.steps.length ||
      options.nameOf(a.root.id).localeCompare(options.nameOf(b.root.id)),
  )

  const seen = new Set<string>()
  const flows: Flow[] = []
  for (const { root, steps } of candidates) {
    if (flows.length >= maxFlows) break
    const key = steps.map((edge) => edge.id).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    flows.push({
      id: `flow:${root.id}`,
      name: options.nameOf(root.id),
      description: flowDescription,
      trigger: options.nameOf(root.id),
      steps: steps.map((edge) => ({ edgeId: edge.id, note: `${options.nameOf(edge.source)} → ${options.nameOf(edge.target)}` })),
    })
  }
  return flows
}

function walk(rootId: string, outgoing: Map<string, GraphEdge[]>, maxSteps: number): GraphEdge[] {
  const steps: GraphEdge[] = []
  const visited = new Set<string>([rootId])
  const visit = (id: string) => {
    for (const edge of outgoing.get(id) ?? []) {
      if (steps.length >= maxSteps) return
      if (visited.has(edge.target)) continue
      visited.add(edge.target)
      steps.push(edge)
      visit(edge.target)
    }
  }
  visit(rootId)
  return steps
}
