import { describe, expect, it } from 'vitest'
import type { ProjectGraph } from '../model/graph'
import { GraphIndex } from '../model/graphIndex'
import { createExplorationReducer, initialExploration, type ExplorationAction, type ExplorationState } from '../exploration/state'
import { miniGraph } from '../testing/miniGraph'
import { buildQuestionContext, contextBudget, excerpt, referencedIds, type QuestionContext } from './context'
import { targetFromSelection } from './target'

const index = new GraphIndex(miniGraph())
const explore = (...actions: ExplorationAction[]): ExplorationState => actions.reduce(createExplorationReducer(index), initialExploration(index))
const ask = (exploration: ExplorationState, question = '質問', previous: QuestionContext['previous'] = null) =>
  buildQuestionContext({ index, exploration, target: targetFromSelection(exploration.selection), question, previous })

const repositoryToGatewayEdge: ExplorationAction = { type: 'select', selection: { kind: 'edge', source: 'type.Impl', target: 'type.GW', edgeIds: ['e.impl-gw'] } }

describe('buildQuestionContext', () => {
  it('describes a selected edge with its evidence and rationale', () => {
    const context = ask(explore({ type: 'enterScope', scopeId: 'pkg.Data' }, { type: 'enterScope', scopeId: 'mod.Impl' }, repositoryToGatewayEdge), 'なぜこの依存関係が必要なの？')

    expect(context.target).toEqual({ kind: 'edge', label: '関係「Impl → GW」' })
    expect(context.subject).toMatchObject({ kind: 'edge', total: 1, byRelation: { depends_on: 1 } })
    if (context.subject.kind !== 'edge') throw new Error('expected edge subject')
    expect(context.subject.examples[0]?.rationale?.text).toBe('通信を差し替えられるようにする')
  })

  it('gives the stated design intent of both ends of a selected edge', () => {
    const graph = miniGraph()
    graph.nodes.find((node) => node.id === 'type.Impl')!.constraints = [{ text: 'Gateway に依存してよい', provenance: 'inferred', source: 'CLAUDE.md' }]
    const local = new GraphIndex(graph)
    const exploration = createExplorationReducer(local)(initialExploration(local), repositoryToGatewayEdge as Extract<ExplorationAction, { type: 'select' }>)
    const context = buildQuestionContext({ index: local, exploration, target: targetFromSelection(exploration.selection), question: '?' })

    if (context.subject.kind !== 'edge') throw new Error('expected edge subject')
    expect(context.subject.drawn.source.constraints).toEqual([{ text: 'Gateway に依存してよい', provenance: 'inferred', source: 'CLAUDE.md' }])
  })

  it('carries the abstraction level and perspective the user is looking from', () => {
    const context = ask(explore({ type: 'enterScope', scopeId: 'pkg.Data' }, { type: 'setPerspective', perspective: 'responsibility' }))

    expect(context.lens.scope).toMatchObject({ id: 'pkg.Data', path: 'App > Data', layer: 'data' })
    expect(context.lens.perspective).toBe('responsibility')
    expect(context.lens.showing).toContain('module')
  })

  it('includes off-screen relations of the subject so the answer can refer to them', () => {
    const context = ask(explore({ type: 'enterScope', scopeId: 'pkg.Data' }, { type: 'enterScope', scopeId: 'mod.Impl' }, { type: 'select', selection: { kind: 'node', nodeId: 'type.Impl' } }))

    expect(context.nearby.map((relation) => relation.id)).toEqual(expect.arrayContaining(['c.fetch-impl', 'c.impl-get']))
    expect(context.nearby.every((relation) => relation.source.id !== relation.target.id)).toBe(true)
  })

  it('tells who relies on the subject even when they are two hops away', () => {
    const context = ask(explore({ type: 'select', selection: { kind: 'node', nodeId: 'pkg.Domain' } }))

    if (context.subject.kind !== 'node') throw new Error('expected node subject')
    expect(context.subject.node.usedBy.direct.map((user) => user.id).sort()).toEqual(['type.Impl', 'type.VM'])
    expect(context.subject.node.usedBy.indirect.map((user) => user.id)).toEqual(['type.View'])
  })

  it('asks about the whole view when nothing is selected', () => {
    const context = ask(explore())

    expect(context.subject).toMatchObject({ kind: 'view', countsByKind: { package: 3 } })
    if (context.subject.kind !== 'view') throw new Error('expected view subject')
    // Every package touches two lifted edges here, so ties are broken by id to stay deterministic.
    expect(context.subject.hubs.map((hub) => [hub.id, hub.degree])).toEqual([
      ['pkg.Data', 2],
      ['pkg.Domain', 2],
      ['pkg.Feature', 2],
    ])
  })

  it('summarizes the trail, collapsing consecutive selections into the last one', () => {
    const context = ask(
      explore(
        { type: 'enterScope', scopeId: 'pkg.Feature' },
        { type: 'select', selection: { kind: 'node', nodeId: 'mod.Screen' } },
        { type: 'select', selection: { kind: 'none' } },
        { type: 'select', selection: { kind: 'node', nodeId: 'mod.Screen' } },
        { type: 'recordQuestion', question: '責務は？' },
      ),
    )

    expect(context.trail).toEqual([
      '「App」(project) の内部に入った',
      '「Feature」(package) の内部に入った',
      'ノード「Screen」 を選択した',
      '質問した: 「責務は？」',
    ])
  })

  it('keeps only the latest trail sentences and reports how many were left out', () => {
    const entering: ExplorationAction[] = []
    for (let i = 0; i < 5; i++) entering.push({ type: 'enterScope', scopeId: 'pkg.Data' }, { type: 'back' })
    const context = ask(explore(...entering))

    expect(context.trail).toHaveLength(contextBudget.trailSteps)
    expect(context.omitted.trailSteps).toBeGreaterThan(0)
  })

  it('passes the previous answer for follow-up questions', () => {
    const context = ask(explore(), 'それはなぜ？', { question: '責務は？', summary: '状態を持つ' })

    expect(context.previous).toEqual({ question: '責務は？', summary: '状態を持つ' })
  })

  it('marks the selected code lines and keeps a few lines around them', () => {
    const context = ask(explore({ type: 'enterScope', scopeId: 'method.VM.load' }, { type: 'select', selection: { kind: 'code', nodeId: 'method.VM.load', lines: { from: 11, to: 11 } } }))

    if (context.subject.kind !== 'code') throw new Error('expected code subject')
    expect(context.subject.owner?.id).toBe('type.VM')
    expect(context.subject.excerpt.split('\n').filter((line) => line.startsWith('>'))).toEqual(['>   11 |   guard !isLoading else { return }'])
  })

  it('is deterministic for the same state', () => {
    const state = explore({ type: 'enterScope', scopeId: 'pkg.Data' }, repositoryToGatewayEdge)
    expect(ask(state)).toEqual(ask(state))
  })
})

describe('context budget', () => {
  function wideGraph(): ProjectGraph {
    const graph = miniGraph()
    for (let i = 0; i < 50; i++) {
      graph.nodes.push({ id: `type.Extra${i}`, kind: 'type', name: `Extra${i}`, parentId: 'mod.Impl' })
      graph.edges.push({ id: `e.extra${i}`, source: `type.Extra${i}`, target: 'type.Repo', relation: 'depends_on', evidence: { text: '', provenance: 'observed' } })
    }
    return graph
  }

  it('keeps the subject in view and counts what was cut when the view exceeds the budget', () => {
    const wide = new GraphIndex(wideGraph())
    const exploration = [
      { type: 'enterScope', scopeId: 'pkg.Data' } as const,
      { type: 'enterScope', scopeId: 'mod.Impl' } as const,
      { type: 'select', selection: { kind: 'node', nodeId: 'type.Impl' } } as const,
    ].reduce(createExplorationReducer(wide), initialExploration(wide))
    const context = buildQuestionContext({ index: wide, exploration, target: targetFromSelection(exploration.selection), question: '?' })

    expect(context.visible.nodes).toHaveLength(contextBudget.visibleNodes)
    expect(context.visible.nodes[0]?.id).toBe('type.Impl')
    expect(context.omitted.visibleNodes).toBe(53 - contextBudget.visibleNodes)
  })

  it('never sends an edge without both of its endpoints', () => {
    const wide = new GraphIndex(wideGraph())
    const exploration = [{ type: 'enterScope', scopeId: 'pkg.Data' } as const, { type: 'enterScope', scopeId: 'mod.Impl' } as const].reduce(
      createExplorationReducer(wide),
      initialExploration(wide),
    )
    const context = buildQuestionContext({ index: wide, exploration, target: { kind: 'view' }, question: '?' })
    const sent = new Set(context.visible.nodes.map((node) => node.id))

    expect(context.visible.edges.every((edge) => sent.has(edge.source) && sent.has(edge.target))).toBe(true)
  })

  it('counts users of the subject that did not fit', () => {
    const wide = new GraphIndex(wideGraph())
    const exploration = createExplorationReducer(wide)(initialExploration(wide), { type: 'select', selection: { kind: 'node', nodeId: 'type.Repo' } })
    const context = buildQuestionContext({ index: wide, exploration, target: targetFromSelection(exploration.selection), question: '?' })

    if (context.subject.kind !== 'node') throw new Error('expected node subject')
    expect(context.subject.node.usedBy.direct).toHaveLength(contextBudget.usedBy)
    expect(context.omitted.usedBy).toBeGreaterThan(0)
  })

  it('shows one example per relation kind first for an aggregated edge', () => {
    const graph = wideGraph()
    graph.edges.push({ id: 'e.rare', source: 'type.Impl', target: 'type.Repo', relation: 'creates', evidence: { text: '', provenance: 'observed' } })
    const wide = new GraphIndex(graph)
    const edgeIds = graph.edges.filter((edge) => edge.target === 'type.Repo' && wide.isWithin(edge.source, 'pkg.Data')).map((edge) => edge.id)
    const exploration = createExplorationReducer(wide)(initialExploration(wide), { type: 'select', selection: { kind: 'edge', source: 'pkg.Data', target: 'pkg.Domain', edgeIds } })
    const context = buildQuestionContext({ index: wide, exploration, target: targetFromSelection(exploration.selection), question: '?' })

    if (context.subject.kind !== 'edge') throw new Error('expected edge subject')
    expect(context.subject.examples).toHaveLength(contextBudget.aggregatedExamples)
    expect(context.subject.examples.map((example) => example.relation)).toContain('creates')
    expect(context.omitted.aggregatedExamples).toBe(edgeIds.length - contextBudget.aggregatedExamples)
  })
})

describe('referencedIds', () => {
  it('includes what the context shows and nothing the user was not looking at', () => {
    const context = ask(explore({ type: 'enterScope', scopeId: 'pkg.Data' }, repositoryToGatewayEdge))
    const ids = referencedIds(context)

    expect([...ids]).toEqual(expect.arrayContaining(['pkg.Data', 'mod.Impl', 'mod.Gateway', 'type.Impl', 'type.GW', 'e.impl-gw']))
    expect(ids.has('method.VM.load')).toBe(false)
  })
})

describe('excerpt', () => {
  it('clamps the surrounding lines to the snippet', () => {
    expect(excerpt('a\nb', 1, { from: 1, to: 1 })).toBe('>    1 | a\n     2 | b')
  })
})
