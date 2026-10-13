import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../../../src/core/model/graphIndex'
import type { GraphNode, ProjectGraph } from '../../../src/core/model/graph'
import { parseModuleDependencies } from './buildScript'
import { KotlinGradleProjectSource } from './kotlinGradleSource'
import { parseSettings } from './settings'

const fixture = fileURLToPath(new URL('./__fixtures__/mini', import.meta.url))

async function loadMini(): Promise<{ graph: ProjectGraph; index: GraphIndex }> {
  const graph = await new KotlinGradleProjectSource(fixture).load()
  return { graph, index: new GraphIndex(graph) }
}

const edgesOf = (graph: ProjectGraph, relation: string) => graph.edges.filter((edge) => edge.relation === relation).map((edge) => edge.id)
const nodeNamed = (graph: ProjectGraph, id: string): GraphNode => {
  const node = graph.nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`missing ${id}`)
  return node
}

describe('settings.gradle.kts', () => {
  it('reads the root name and modules from include calls, ignoring comments', () => {
    const settings = parseSettings('rootProject.name = "x"\ninclude(":a:b", ":c")\n// include(":d")\ninclude(":e")')
    expect(settings).toEqual({ rootProjectName: 'x', modules: [':a:b', ':c', ':e'] })
  })
})

describe('module dependencies in build scripts', () => {
  it('matches type-safe accessors to module paths regardless of case and separators', () => {
    const script = 'dependencies {\napi(projects.data.repositoryImpl)\n  implementation(projects.tools.kspProcessor)\n// api(projects.core)\n}'
    const dependencies = parseModuleDependencies(script, [':data:repository-impl', ':tools:ksp-processor', ':core'])
    expect(dependencies.map((dependency) => [dependency.target, dependency.line, dependency.text])).toEqual([
      [':data:repository-impl', 2, 'api(projects.data.repositoryImpl)'],
      [':tools:ksp-processor', 3, 'implementation(projects.tools.kspProcessor)'],
    ])
  })
})

describe('module dependencies versus framework exports', () => {
  it('ignores export(...) and anything outside a dependencies block', () => {
    const script = [
      'binaries.framework {',
      '    export(projects.core)',
      '}',
      'commonMain.dependencies {',
      '    api(projects.domain.model)',
      '}',
      'api(projects.data.repository)',
    ].join('\n')
    const dependencies = parseModuleDependencies(script, [':core', ':domain:model', ':data:repository'])
    expect(dependencies.map((dependency) => dependency.target)).toEqual([':domain:model'])
  })
})

describe('loading a Gradle Kotlin Multiplatform project', () => {
  it('finds the included modules under their groups and leaves tools out', async () => {
    const { graph } = await loadMini()
    const modules = graph.nodes.filter((node) => node.kind === 'module').map((node) => [node.name, node.parentId])
    expect(modules).toEqual([
      ['core', 'group:core'],
      ['data:repositoryimpl', 'group:data'],
      ['domain:model', 'group:domain'],
      ['domain:usecase', 'group:domain'],
    ])
    expect(graph.nodes.some((node) => node.id.includes('Gen'))).toBe(false)
    expect(nodeNamed(graph, 'project').name).toBe('mini-app')
  })

  it('assigns layers to groups and carries the project layer rules', async () => {
    const { graph } = await loadMini()
    expect(nodeNamed(graph, 'group:domain').layer).toBe('domain')
    expect(nodeNamed(graph, 'group:data').layer).toBe('data')
    expect(nodeNamed(graph, 'group:core').layer).toBeUndefined()
    expect(graph.layerRules?.domain).toContain('data')
  })

  it('turns build script dependencies into module edges that point at the script line', async () => {
    const { graph } = await loadMini()
    expect(edgesOf(graph, 'depends_on').filter((id) => id.startsWith('dep:')).sort()).toEqual([
      'dep:data:repositoryimpl->core',
      'dep:data:repositoryimpl->domain:usecase',
      'dep:domain:usecase->core',
      'dep:domain:usecase->domain:model',
    ])
    const edge = graph.edges.find((candidate) => candidate.id === 'dep:domain:usecase->domain:model')
    expect(edge?.evidence).toEqual({ text: 'api(projects.domain.model)', provenance: 'observed', source: 'domain/usecase/build.gradle.kts:8' })
  })

  it('does not turn a framework export into a module dependency', async () => {
    const { graph } = await loadMini()
    expect(graph.edges.some((edge) => edge.id === 'dep:data:repositoryimpl->domain:model')).toBe(false)
  })

  it('puts types directly under a single-package module and namespaces under a multi-package module', async () => {
    const { graph } = await loadMini()
    expect(nodeNamed(graph, 'type:com.example.domain.model.Book').parentId).toBe('module:domain:model')
    expect(graph.nodes.filter((node) => node.parentId === 'module:domain:usecase').map((node) => [node.id, node.name])).toEqual([
      ['ns:domain:usecase:account', 'account'],
      ['ns:domain:usecase:book', 'book'],
    ])
    expect(nodeNamed(graph, 'type:com.example.domain.usecase.book.GetBookUseCase').parentId).toBe('ns:domain:usecase:book')
  })

  it('skips build directories and test source sets', async () => {
    const { graph } = await loadMini()
    expect(graph.nodes.some((node) => node.name === 'Generated' || node.name === 'OnlyInTest')).toBe(false)
  })

  it('recognizes type flavors and uses the KDoc first sentence as the summary', async () => {
    const { graph } = await loadMini()
    const flavor = (name: string) => nodeNamed(graph, `type:com.example.domain.model.${name}`).flavor
    expect([flavor('Book'), flavor('BookStatus'), flavor('LoadState'), flavor('Defaults')]).toEqual(['class', 'enum', 'interface', 'object'])
    expect(nodeNamed(graph, 'type:com.example.domain.model.Book').summary).toBe('本 1 冊を表す。')
    expect(nodeNamed(graph, 'type:com.example.domain.usecase.book.GetBookUseCase').summary).toBe('本を 1 冊取得する。')
    expect(nodeNamed(graph, 'type:com.example.domain.model.Defaults').summary).toBe('object Defaults')
  })

  it('reads members as method and property nodes, numbering overloads', async () => {
    const { graph } = await loadMini()
    const ids = graph.nodes.filter((node) => node.parentId === 'type:com.example.data.GetBookUseCaseImpl').map((node) => node.id)
    expect(ids).toEqual([
      'method:com.example.data.GetBookUseCaseImpl.execute',
      'method:com.example.data.GetBookUseCaseImpl.overloaded',
      'method:com.example.data.GetBookUseCaseImpl.overloaded#2',
    ])
    expect(nodeNamed(graph, 'method:com.example.data.GetBookUseCaseImpl.execute').code).toMatchObject({
      language: 'kotlin',
      path: 'data/repositoryimpl/src/commonMain/kotlin/com/example/data/GetBookUseCaseImpl.kt',
      startLine: 11,
    })
  })

  it('keeps member code intact when strings and raw strings contain braces', async () => {
    const { graph } = await loadMini()
    const code = (name: string) => nodeNamed(graph, `method:com.example.core.a.Messages.${name}`).code
    expect(code('braces')?.text.split('\n').at(-1)).toBe('    }')
    expect(code('braces')?.text).toContain('closing } inside string')
    expect(code('raw')?.text.split('\n')).toHaveLength(3)
    expect(nodeNamed(graph, 'prop:com.example.core.a.Messages.after').code?.startLine).toBe(12)
    expect(nodeNamed(graph, 'method:com.example.core.a.Messages.last').code?.text).toBe('    fun last() = 2')
  })

  it('shows the declaration of a type without members', async () => {
    const { graph } = await loadMini()
    expect(nodeNamed(graph, 'type:com.example.core.b.Item').code?.text).toBe('class Item')
  })

  it('reads top-level functions as methods under the namespace, numbering overloads and naming extensions by receiver', async () => {
    const { graph } = await loadMini()
    const functions = graph.nodes.filter((node) => node.id.startsWith('fn:com.example.domain.usecase.account')).map((node) => [node.id, node.name, node.parentId])
    expect(functions).toEqual([
      ['fn:com.example.domain.usecase.account.Item.describe', 'Item.describe', 'ns:domain:usecase:account'],
      ['fn:com.example.domain.usecase.account.showItem', 'showItem', 'ns:domain:usecase:account'],
      ['fn:com.example.domain.usecase.account.showItem#2', 'showItem', 'ns:domain:usecase:account'],
    ])
    const describe = nodeNamed(graph, 'fn:com.example.domain.usecase.account.Item.describe')
    expect(describe.kind).toBe('method')
    expect(describe.code?.text).toBe('fun <T> Item?.describe(extra: T): String {\n    return "}"\n}')
    expect(describe.summary).toBe('fun <T> Item?.describe(extra: T): String {')
    expect(nodeNamed(graph, 'fn:com.example.domain.usecase.account.showItem').code?.text).toBe('@Composable\nfun showItem(item: Item): String = "x"')
  })

  it('keeps one function node for an expect/actual pair', async () => {
    const { graph } = await loadMini()
    expect(graph.nodes.filter((node) => node.id.startsWith('fn:com.example.core.a.platformName')).map((node) => node.id)).toEqual([
      'fn:com.example.core.a.platformName',
    ])
  })

  it('links a function to the types it references', async () => {
    const { graph } = await loadMini()
    const edge = graph.edges.find((candidate) => candidate.id === 'ref:fn:com.example.domain.usecase.account.showItem->com.example.core.b.Item')
    expect(edge?.source).toBe('fn:com.example.domain.usecase.account.showItem')
    expect(edge?.target).toBe('type:com.example.core.b.Item')
    expect(edge?.evidence.source).toBe('domain/usecase/src/commonMain/kotlin/com/example/domain/usecase/account/Functions.kt:6')
  })

  it('does not resolve a name declared inside the type to a same-named top-level type', async () => {
    const { graph } = await loadMini()
    const refs = graph.edges.filter((edge) => edge.source === 'type:com.example.core.a.Holder').map((edge) => edge.target)
    expect(refs).toEqual(['type:com.example.core.a.Logger'])
  })

  it('links supertypes as implements edges', async () => {
    const { graph } = await loadMini()
    expect(edgesOf(graph, 'implements')).toEqual([
      'impl:com.example.core.a.NoopLogger->com.example.core.a.Logger',
      'impl:com.example.data.GetBookUseCaseImpl->com.example.domain.usecase.book.GetBookUseCase',
    ])
  })

  it('resolves references through imports and drops ambiguous names', async () => {
    const { graph } = await loadMini()
    const refs = edgesOf(graph, 'depends_on').filter((id) => id.startsWith('ref:'))
    expect(refs).toContain('ref:com.example.domain.usecase.account.ExplicitUser->com.example.core.b.Item')
    expect(refs).toContain('ref:com.example.domain.usecase.account.ExplicitUser->com.example.core.a.Item')
    expect(refs).toContain('ref:com.example.data.GetBookUseCaseImpl->com.example.domain.model.Book')
    expect(refs.filter((id) => id.includes('AmbiguousUser'))).toEqual([])
    expect(refs.some((id) => id.includes('->com.example.domain.usecase.book.GetBookUseCase'))).toBe(false)
  })

  it('records the reference line as evidence', async () => {
    const { graph } = await loadMini()
    const edge = graph.edges.find((candidate) => candidate.id === 'ref:com.example.data.GetBookUseCaseImpl->com.example.core.a.Logger')
    expect(edge?.evidence).toEqual({
      text: 'Logger を参照',
      provenance: 'observed',
      source: 'data/repositoryimpl/src/commonMain/kotlin/com/example/data/GetBookUseCaseImpl.kt:9',
    })
  })

  it('attaches CLAUDE.md claims as inferred', async () => {
    const { graph } = await loadMini()
    expect(nodeNamed(graph, 'module:domain:usecase').responsibility).toEqual({
      text: 'UseCase interface と *Params',
      provenance: 'inferred',
      source: 'CLAUDE.md',
    })
    expect(nodeNamed(graph, 'module:data:repositoryimpl').constraints).toEqual([
      { text: '依存してよい: domain:usecase / core', provenance: 'inferred', source: 'CLAUDE.md 依存の向き' },
    ])
    expect(nodeNamed(graph, 'module:domain:model').constraints).toBeUndefined()
  })

  it('produces a graph that passes the integrity checks', async () => {
    const { index } = await loadMini()
    expect(index.root.name).toBe('mini-app')
  })
})
