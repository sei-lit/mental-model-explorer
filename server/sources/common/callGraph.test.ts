import { describe, expect, it } from 'vitest'
import { deriveFlows, resolveCalls, type FunctionFacts, type TypeFacts } from './callGraph'

const resolver = (known: Record<string, string>) => (name: string) => known[name] ?? null
const names = { ViewModel: 'type:VM', UseCase: 'type:UC', Repository: 'type:Repo', RepositoryImpl: 'type:Impl', Gateway: 'type:GW' }
const resolve = resolver(names)

const type = (id: string, methods: Record<string, string>, extra: Partial<TypeFacts> = {}): TypeFacts => ({
  id,
  isAbstract: false,
  propertyTypes: new Map(),
  methods: new Map(Object.entries(methods).map(([name, nodeId]) => [name, [nodeId]])),
  supertypeIds: [],
  resolveType: resolve,
  ...extra,
})

const types: TypeFacts[] = [
  type('type:VM', { load: 'm:VM.load', render: 'm:VM.render' }, { propertyTypes: new Map([['useCase', 'UseCase']]) }),
  type('type:UC', { execute: 'm:UC.execute' }, { propertyTypes: new Map([['repository', 'Repository']]) }),
  type('type:Repo', { fetch: 'm:Repo.fetch' }, { isAbstract: true }),
  type('type:Impl', { fetch: 'm:Impl.fetch' }, { supertypeIds: ['type:Repo'], propertyTypes: new Map([['gateway', 'Gateway']]) }),
  type('type:GW', { get: 'm:GW.get' }),
]

const fn = (nodeId: string, ownerTypeId: string, calls: FunctionFacts['calls'], localTypes: Record<string, string> = {}): FunctionFacts => ({
  nodeId,
  ownerTypeId,
  path: 'File.kt',
  localTypes: new Map(Object.entries(localTypes)),
  calls,
  resolveType: resolve,
})

const site = (receiver: string | null, method: string, line = 1) => ({ receiver, method, line, text: `${receiver ? `${receiver}.` : ''}${method}(` })

const functions: FunctionFacts[] = [
  fn('m:VM.load', 'type:VM', [site('useCase', 'execute', 10), site(null, 'render', 11)]),
  fn('m:UC.execute', 'type:UC', [site('repository', 'fetch', 20)]),
  fn('m:Impl.fetch', 'type:Impl', [site('gateway', 'get', 30), site('items', 'map', 31)]),
]

describe('resolveCalls', () => {
  const edges = resolveCalls(types, functions)
  const pairs = edges.map((edge) => `${edge.source} -> ${edge.target}`)

  it('resolves calls through the declared types of properties and the owner itself', () => {
    expect(pairs).toEqual(expect.arrayContaining(['m:VM.load -> m:UC.execute', 'm:VM.load -> m:VM.render', 'm:UC.execute -> m:Repo.fetch', 'm:Impl.fetch -> m:GW.get']))
  })

  it('adds a dispatch from an interface method to the implementations', () => {
    expect(pairs).toContain('m:Repo.fetch -> m:Impl.fetch')
  })

  it('marks every call as a static-analysis candidate with the call site as evidence', () => {
    expect(edges.find((edge) => edge.id === 'call:m:VM.load->m:UC.execute')?.evidence).toEqual({ text: 'useCase.execute(', provenance: 'inferred', source: 'File.kt:10' })
  })

  it('drops calls whose receiver type is unknown', () => {
    expect(pairs.some((pair) => pair.includes('map'))).toBe(false)
  })

  it('types a receiver from a local declaration before a property of the same name', () => {
    const shadowed = resolveCalls(types, [fn('m:VM.load', 'type:VM', [site('useCase', 'get')], { useCase: 'Gateway' })])
    expect(shadowed.map((edge) => edge.target)).toEqual(['m:GW.get'])
  })
})

describe('deriveFlows', () => {
  const edges = resolveCalls(types, functions)
  const nameOf = (id: string) => id.replace('m:', '')

  it('walks from a lifecycle entry point through the calls in order', () => {
    const [flow] = deriveFlows(edges, { entryKind: (id) => (id === 'm:VM.load' ? 'lifecycle' : null), nameOf })

    expect(flow?.name).toBe('VM.load')
    expect(flow?.steps.map((step) => step.note)).toEqual(['VM.load → UC.execute', 'UC.execute → Repo.fetch', 'Repo.fetch → Impl.fetch', 'Impl.fetch → GW.get', 'VM.load → VM.render'])
  })

  it('does not start a non-lifecycle flow at a function that something calls', () => {
    const flows = deriveFlows(edges, { entryKind: () => 'other', nameOf })

    expect(flows.map((flow) => flow.name)).toEqual(['VM.load'])
  })

  it('drops walks shorter than the minimum', () => {
    expect(deriveFlows(edges, { entryKind: (id) => (id === 'm:Impl.fetch' ? 'lifecycle' : null), nameOf })).toEqual([])
  })
})
