import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../../../src/core/model/graphIndex'
import type { GraphNode, ProjectGraph } from '../../../src/core/model/graph'
import { SwiftPackageProjectSource } from './swiftPackageSource'

const repoRoot = fileURLToPath(new URL('./__fixtures__/mini', import.meta.url))
const packageDir = `${repoRoot}/AppPackage`
const kotlinThing = 'kotlin:type:shared.SharedThing'

async function loadMini(withBridge = false): Promise<ProjectGraph> {
  const bridge = withBridge ? { moduleName: 'UsapoShared', types: new Map([['SharedThing', kotlinThing]]) } : undefined
  return new SwiftPackageProjectSource(packageDir, { repoRoot, ...(bridge ? { bridge } : {}) }).load()
}

const edgeIds = (graph: ProjectGraph, relation: string) => graph.edges.filter((edge) => edge.relation === relation).map((edge) => edge.id)
const nodeOf = (graph: ProjectGraph, id: string): GraphNode => {
  const node = graph.nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`missing ${id}`)
  return node
}

describe('loading a Swift package', () => {
  it('builds a graph that passes the integrity checks, with every id under ios:', async () => {
    const graph = await loadMini()
    expect(() => new GraphIndex(graph)).not.toThrow()
    expect(graph.rootId).toBe('ios')
    expect(nodeOf(graph, 'ios')).toMatchObject({ kind: 'project', name: 'MiniPackage', parentId: null })
    for (const id of [...graph.nodes.map((node) => node.id), ...graph.edges.map((edge) => edge.id), ...graph.flows.map((flow) => flow.id)]) {
      expect(id === 'ios' || id.startsWith('ios:')).toBe(true)
    }
  })

  it('groups targets by TargetGroup and leaves out tests, but keeps the binary target', async () => {
    const graph = await loadMini()
    const modules = graph.nodes.filter((node) => node.kind === 'module').map((node) => [node.name, node.parentId] as [string, string | null])
    expect(modules.sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ['Const', 'ios:group:core'],
      ['ItemFeature', 'ios:group:feature'],
      ['ItemModel', 'ios:group:model'],
      ['ItemRepository', 'ios:group:serviceAndManager'],
      ['ItemScreenRequests', 'ios:group:screenRequest'],
      ['OtherModel', 'ios:group:model'],
      ['UsapoShared', 'ios:group:other'],
    ])
    expect(graph.nodes.some((node) => node.name === 'ItemFeatureTests' || node.name === 'OnlyInTests')).toBe(false)
    expect(graph.nodes.filter((node) => node.parentId === 'ios:module:UsapoShared')).toEqual([])
  })

  it('reads dependencies from variables, with the entry line as evidence, and ignores comments and external products', async () => {
    const graph = await loadMini()
    expect(edgeIds(graph, 'depends_on').filter((id) => id.startsWith('ios:dep:')).sort()).toEqual([
      'ios:dep:ItemFeature->ItemModel',
      'ios:dep:ItemFeature->ItemScreenRequests',
      'ios:dep:ItemFeature->OtherModel',
      'ios:dep:ItemFeature->UsapoShared',
      'ios:dep:ItemModel->Const',
      'ios:dep:ItemRepository->ItemModel',
    ])
    const dependency = graph.edges.find((edge) => edge.id === 'ios:dep:ItemModel->Const')
    expect(dependency?.evidence).toEqual({ text: 'const', provenance: 'observed', source: 'AppPackage/Package.swift:36' })
  })

  it('puts files in namespaces only when the target has two or more directories', async () => {
    const graph = await loadMini()
    const namespaces = graph.nodes.filter((node) => node.kind === 'namespace').map((node) => [node.id, node.parentId])
    expect(namespaces).toEqual([
      ['ios:ns:ItemFeature/ItemDetail', 'ios:module:ItemFeature'],
      ['ios:ns:ItemFeature/ItemList', 'ios:module:ItemFeature'],
    ])
    expect(nodeOf(graph, 'ios:type:ItemFeature.Formatting').parentId).toBe('ios:module:ItemFeature')
    expect(nodeOf(graph, 'ios:type:ItemFeature.ItemListViewModel').parentId).toBe('ios:ns:ItemFeature/ItemList')
    expect(graph.nodes.some((node) => node.name === 'GeneratedOnly')).toBe(false)
    expect(nodeOf(graph, 'ios:type:ItemModel.Item').parentId).toBe('ios:module:ItemModel')
  })

  it('gives each declaration its flavor and the first doc sentence as summary', async () => {
    const graph = await loadMini()
    expect(nodeOf(graph, 'ios:type:ItemModel.Item')).toMatchObject({ flavor: 'struct', summary: '一覧に並ぶ商品。' })
    expect(nodeOf(graph, 'ios:type:ItemModel.ItemFetching').flavor).toBe('protocol')
    expect(nodeOf(graph, 'ios:type:ItemRepository.ItemCache').flavor).toBe('actor')
    expect(nodeOf(graph, 'ios:type:Const.Const').flavor).toBe('enum')
  })

  it('merges an extension of a type in the same target and makes external extensions their own nodes', async () => {
    const graph = await loadMini()
    expect(graph.nodes.some((node) => node.id === 'ios:ext:ItemModel.Item')).toBe(false)
    expect(nodeOf(graph, 'ios:prop:ItemModel.Item.title').parentId).toBe('ios:type:ItemModel.Item')
    expect(nodeOf(graph, 'ios:method:ItemModel.Item.reload').code?.path).toBe('AppPackage/Sources/ItemModel/Item+Title.swift')
    expect(nodeOf(graph, 'ios:method:ItemFeature.ItemListViewModel.didTapShare').parentId).toBe('ios:type:ItemFeature.ItemListViewModel')

    expect(nodeOf(graph, 'ios:ext:ItemRepository.String')).toMatchObject({ name: 'extension String', flavor: 'extension' })
    expect(nodeOf(graph, 'ios:method:ItemRepository.String.trimmedTitle').parentId).toBe('ios:ext:ItemRepository.String')
    expect(nodeOf(graph, 'ios:ext:ItemFeature.View').flavor).toBe('extension')
    expect(edgeIds(graph, 'depends_on').filter((id) => id.startsWith('ios:extends:'))).toEqual(['ios:extends:ios:ext:ItemFeature.Item->ios:type:ItemModel.Item'])
  })

  it('finds members including property wrappers, init and operators, and skips enum cases', async () => {
    const graph = await loadMini()
    const members = (typeId: string) => graph.nodes.filter((node) => node.parentId === typeId).map((node) => `${node.kind}:${node.name}`)
    expect(members('ios:type:ItemFeature.ItemDetailView')).toEqual(['property:viewModel', 'property:item', 'property:other', 'property:body'])
    expect(members('ios:type:ItemFeature.ItemListViewModel')).toEqual([
      'property:fetcher',
      'property:clash',
      'property:shared',
      'method:init',
      'method:didTapRetry',
      'method:reload',
      'method:make',
      'method:didTapShare',
      'method:==',
    ])
    expect(members('ios:type:ItemScreenRequests.ItemScreenRequests')).toEqual([])
    expect(nodeOf(graph, 'ios:prop:ItemFeature.ItemDetailView.viewModel').code).toMatchObject({ language: 'swift', startLine: 5, text: '    @State private var viewModel: ItemListViewModel' })
  })

  it('keeps matching braces across interpolation, raw strings and multi-line strings', async () => {
    const graph = await loadMini()
    const formatting = graph.nodes.filter((node) => node.parentId === 'ios:type:ItemFeature.Formatting').map((node) => node.name)
    expect(formatting).toEqual(['greeting', 'raw', 'text', 'afterStrings'])
  })

  it('links conformances to the types they resolve to', async () => {
    const graph = await loadMini()
    expect(edgeIds(graph, 'implements').sort()).toEqual([
      'ios:impl:ios:type:ItemRepository.LiveItemFetcher->ios:type:ItemModel.ItemFetching',
    ])
  })

  it('resolves referenced names through the declaring target and the imports, and drops ambiguous or unimported names', async () => {
    const graph = await loadMini()
    const references = (from: string) => edgeIds(graph, 'depends_on').filter((id) => id.startsWith(`ios:ref:${from}->`)).map((id) => id.split('->')[1])
    expect(references('ios:type:ItemFeature.ItemListViewModel').sort()).toEqual(['ios:type:ItemModel.ItemFetching'])
    expect(references('ios:type:ItemFeature.ItemDetailView')).toEqual(['ios:type:ItemModel.Item', 'ios:type:ItemFeature.ItemListViewModel'].sort())
    expect(references('ios:type:ItemModel.Item')).toEqual(['ios:type:Const.Const'])
    expect(references('ios:type:ItemRepository.LiveItemFetcher')).toEqual(['ios:type:ItemModel.Item'])
  })

  it('draws calls through declared types, dispatches protocol calls to implementations and derives a flow from a tap handler', async () => {
    const graph = await loadMini()
    expect(edgeIds(graph, 'calls').sort()).toEqual([
      'ios:call:ios:prop:ItemFeature.ItemDetailView.body->ios:method:ItemFeature.ItemListViewModel.didTapRetry',
      'ios:call:ios:method:ItemFeature.ItemListViewModel.didTapRetry->ios:method:ItemFeature.ItemListViewModel.reload',
      'ios:call:ios:method:ItemFeature.ItemListViewModel.reload->ios:method:ItemModel.ItemFetching.fetch',
      'ios:dispatch:ios:method:ItemModel.ItemFetching.fetch->ios:method:ItemRepository.LiveItemFetcher.fetch',
    ].sort())
    const flow = graph.flows.find((candidate) => candidate.name === 'ItemListViewModel.didTapRetry')
    expect(flow?.id).toBe('ios:flow:ios:method:ItemFeature.ItemListViewModel.didTapRetry')
    expect(flow?.steps.map((step) => step.note)).toEqual([
      'ItemListViewModel.didTapRetry → ItemListViewModel.reload',
      'ItemListViewModel.reload → ItemFetching.fetch',
      'ItemFetching.fetch → LiveItemFetcher.fetch',
    ])
    expect(graph.flows.map((candidate) => candidate.name)).toContain('ItemDetailView.body')
  })

  it('draws bridge edges only from files that import the bridge module', async () => {
    const graph = await loadMini(true)
    const bridged = graph.edges.filter((edge) => edge.id.startsWith('ios:bridge:'))
    expect(bridged.map((edge) => [edge.source, edge.target, edge.relation, edge.evidence.provenance])).toEqual([
      ['ios:type:ItemFeature.ItemListViewModel', kotlinThing, 'depends_on', 'inferred'],
    ])
    expect(bridged[0]?.evidence.text).toBe('SharedThing を参照（UsapoShared 経由。名前の一致で推定）')
    expect((await loadMini()).edges.some((edge) => edge.id.startsWith('ios:bridge:'))).toBe(false)
  })

  it('assigns a layer only when the module kind determines it, and explains the kind', async () => {
    const graph = await loadMini()
    const layers = Object.fromEntries(graph.nodes.filter((node) => node.kind === 'module').map((node) => [node.name, node.layer ?? null]))
    expect(layers).toEqual({
      Const: 'ios.kernel',
      ItemFeature: 'ios.feature',
      ItemModel: null,
      ItemRepository: 'ios.domainImpl',
      ItemScreenRequests: 'ios.domain',
      OtherModel: null,
      UsapoShared: null,
    })
    expect(graph.layers?.map((layer) => [layer.id, layer.label])).toEqual([
      ['ios.app', 'L6 App'],
      ['ios.feature', 'L5 Feature'],
      ['ios.domainImpl', 'L4 DomainImpl'],
      ['ios.toolkit', 'L3 Toolkit'],
      ['ios.domain', 'L2 Domain'],
      ['ios.sharedVocabulary', 'L1 SharedVocabulary'],
      ['ios.kernel', 'L0 Kernel'],
    ])
    const feature = nodeOf(graph, 'ios:module:ItemFeature')
    expect(feature.responsibility).toEqual({
      text: '画面ドメイン新設時に ScreenRequests とペアで機械的に作成',
      provenance: 'inferred',
      source: 'docs/architecture/module-kinds.md',
    })
    expect(feature.role?.text).toBe('種別: Feature（命名と TargetGroup から推定）')
    expect(nodeOf(graph, 'ios:module:ItemModel').responsibility).toBeUndefined()
  })

  it('encodes the dependency rules between layers', async () => {
    const layers = new Map((await loadMini()).layers?.map((layer) => [layer.id, layer.mayDependOn]))
    expect(layers.get('ios.feature')).not.toContain('ios.feature')
    expect(layers.get('ios.toolkit')).not.toContain('ios.domain')
    expect(layers.get('ios.toolkit')).toContain('ios.toolkit')
    expect(layers.get('ios.domain')).toEqual(['ios.sharedVocabulary', 'ios.kernel'])
    expect(layers.get('ios.kernel')).toEqual(['ios.kernel'])
  })
})
