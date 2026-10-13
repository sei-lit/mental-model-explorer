import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../model/graphIndex'
import { createExplorationReducer, initialExploration, type ExplorationAction, type Selection } from '../exploration/state'
import { bookShelfGraph } from '../../data/sample/bookShelf'
import { miniGraph } from '../testing/miniGraph'
import { validateAnswer } from './answer'
import { buildQuestionContext } from './context'
import { detectIntent, mentionedNodes, MockResponder } from './mockResponder'
import { targetFromSelection } from './target'

function contextFor(index: GraphIndex, question: string, ...actions: ExplorationAction[]) {
  const exploration = actions.reduce(createExplorationReducer(index), initialExploration(index))
  return buildQuestionContext({ index, exploration, target: targetFromSelection(exploration.selection), question })
}

describe('MockResponder', () => {
  const index = new GraphIndex(miniGraph())
  const responder = new MockResponder(index)

  it('answers a removal question with a what-if visual on the node named in the question', async () => {
    const answer = await responder.ask(contextFor(index, 'Repository を削除するとどうなる？'))

    expect(answer.visuals).toEqual([{ type: 'whatIfRemove', nodeIds: ['type.Repo'] }])
    expect(answer.highlights).toEqual(expect.arrayContaining([{ ref: 'type.UC', role: 'affected' }]))
  })

  it('explains why a selected dependency exists from its rationale', async () => {
    const edge: Selection = { kind: 'edge', source: 'type.Impl', target: 'type.GW', edgeIds: ['e.impl-gw'] }
    const answer = await responder.ask(contextFor(index, 'なぜこの依存関係が必要なの？', { type: 'select', selection: edge }))

    expect(answer.summary).toBe('通信を差し替えられるようにする')
    expect(answer.highlights).toEqual(expect.arrayContaining([{ ref: 'e.impl-gw', role: 'path' }]))
  })

  it('traces the selected flow when asked about the flow', async () => {
    const answer = await responder.ask(contextFor(index, 'この流れを教えて', { type: 'setPerspective', perspective: 'flow' }))

    expect(answer.visuals).toEqual([{ type: 'trace', label: '読み込み', edgeIds: ['c.load-exec', 'c.exec-fetch', 'c.fetch-impl', 'c.impl-get'] }])
  })

  it('falls back to the kind of target when the question has no keyword', () => {
    expect(detectIntent(contextFor(index, '？', { type: 'select', selection: { kind: 'nodes', nodeIds: ['type.VM', 'type.UC'] } }))).toBe('compare')
    expect(detectIntent(contextFor(index, '？', { type: 'select', selection: { kind: 'code', nodeId: 'method.VM.load', lines: { from: 10, to: 11 } } }))).toBe('code')
    expect(detectIntent(contextFor(index, '？'))).toBe('overview')
  })

  it('ranks longer matches first and an exact name before an alias', () => {
    expect(mentionedNodes(index, 'Gateway と Repository')).toEqual(['type.Repo', 'mod.Gateway', 'type.GW'])
  })

  it('removes the mentioned node that is on screen when several match', async () => {
    const answer = await responder.ask(contextFor(index, 'Gateway を削除するとどうなる？', { type: 'enterScope', scopeId: 'pkg.Data' }, { type: 'enterScope', scopeId: 'mod.Gateway' }))

    expect(answer.visuals).toEqual([{ type: 'whatIfRemove', nodeIds: ['type.GW'] }])
  })
})

describe('MockResponder on the bundled sample', () => {
  const index = new GraphIndex(bookShelfGraph)
  const responder = new MockResponder(index)
  const firstMethod = bookShelfGraph.nodes.find((node) => node.code)!
  const anEdge = bookShelfGraph.edges[0]!
  const targets: [string, ExplorationAction[]][] = [
    ['view', []],
    ['node', [{ type: 'select', selection: { kind: 'node', nodeId: 'pkg.data' } }]],
    ['nodes', [{ type: 'select', selection: { kind: 'nodes', nodeIds: ['pkg.data', 'pkg.domain'] } }]],
    ['edge', [{ type: 'select', selection: { kind: 'edge', source: anEdge.source, target: anEdge.target, edgeIds: [anEdge.id] } }]],
    ['code', [{ type: 'select', selection: { kind: 'code', nodeId: firstMethod.id, lines: { from: firstMethod.code!.startLine, to: firstMethod.code!.startLine + 1 } } }]],
  ]
  const questions = ['責務は？', 'なぜ必要？', 'どう違う？', 'Repository を削除するとどうなる？', '流れは？', 'この処理は何を保証している？']

  // The mock stands in for the real model, so it must never produce references the UI would reject.
  it.each(targets)('only references existing elements for a %s target', async (_, actions) => {
    for (const question of questions) {
      const raw = await responder.ask(contextFor(index, question, ...actions))
      expect(validateAnswer(raw, index).issues).toEqual([])
    }
  })
})
