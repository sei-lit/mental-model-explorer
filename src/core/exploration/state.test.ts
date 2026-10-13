import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../model/graphIndex'
import { miniGraph } from '../testing/miniGraph'
import { createExplorationReducer, initialExploration, TRAIL_LIMIT, type ExplorationAction, type ExplorationState } from './state'

const graph = miniGraph()
graph.nodes.push({ id: 'prop.VM.empty', kind: 'property', name: 'empty', parentId: 'type.VM' })
const index = new GraphIndex(graph)
const reduce = createExplorationReducer(index)
const run = (...actions: ExplorationAction[]): ExplorationState => actions.reduce(reduce, initialExploration(index))

describe('exploration reducer', () => {
  it('selects the entered node so the next question is about it', () => {
    const state = run({ type: 'enterScope', scopeId: 'pkg.Data' })

    expect(state.scopeId).toBe('pkg.Data')
    expect(state.selection).toEqual({ kind: 'node', nodeId: 'pkg.Data' })
  })

  it('selects the child the user came from when going back up', () => {
    const state = run({ type: 'enterScope', scopeId: 'pkg.Data' }, { type: 'enterScope', scopeId: 'mod.Impl' }, { type: 'enterScope', scopeId: 'project' })

    expect(state.selection).toEqual({ kind: 'node', nodeId: 'pkg.Data' })
  })

  it('ignores entering a node that has neither children nor code', () => {
    const state = run({ type: 'enterScope', scopeId: 'prop.VM.empty' })

    expect(state.scopeId).toBe('project')
  })

  it('keeps scope and selection when the perspective changes', () => {
    const state = run(
      { type: 'enterScope', scopeId: 'mod.Screen' },
      { type: 'select', selection: { kind: 'node', nodeId: 'type.VM' } },
      { type: 'setPerspective', perspective: 'responsibility' },
    )

    expect(state).toMatchObject({ scopeId: 'mod.Screen', perspective: 'responsibility', selection: { kind: 'node', nodeId: 'type.VM' } })
  })

  it('picks a flow that passes through the scope when switching to the flow perspective', () => {
    const graph = miniGraph()
    graph.flows.unshift({ id: 'flow.elsewhere', name: 'elsewhere', description: '', trigger: '', steps: [{ edgeId: 'c.impl-get', note: '' }] })
    const local = new GraphIndex(graph)
    const reduceLocal = createExplorationReducer(local)
    const state = [{ type: 'enterScope', scopeId: 'pkg.Feature' } as const, { type: 'setPerspective', perspective: 'flow' } as const].reduce(reduceLocal, initialExploration(local))

    expect(state.flowId).toBe('flow.load')
  })

  it('goes back and forward through viewpoints', () => {
    const entered = run({ type: 'enterScope', scopeId: 'pkg.Data' }, { type: 'enterScope', scopeId: 'mod.Impl' })
    const back = reduce(entered, { type: 'back' })
    const forward = reduce(back, { type: 'forward' })

    expect(back.scopeId).toBe('pkg.Data')
    expect(forward.scopeId).toBe('mod.Impl')
    expect(reduce(run(), { type: 'back' }).scopeId).toBe('project')
  })

  it('drops forward history when navigating after going back', () => {
    const state = run(
      { type: 'enterScope', scopeId: 'pkg.Data' },
      { type: 'back' },
      { type: 'enterScope', scopeId: 'pkg.Domain' },
      { type: 'forward' },
    )

    expect(state.scopeId).toBe('pkg.Domain')
  })

  it('grows and shrinks a multi-selection by toggling nodes', () => {
    const one = run({ type: 'toggleNodeInSelection', nodeId: 'type.VM' })
    const two = reduce(one, { type: 'toggleNodeInSelection', nodeId: 'type.UC' })
    const backToOne = reduce(two, { type: 'toggleNodeInSelection', nodeId: 'type.VM' })
    const none = reduce(backToOne, { type: 'toggleNodeInSelection', nodeId: 'type.UC' })

    expect(one.selection).toEqual({ kind: 'node', nodeId: 'type.VM' })
    expect(two.selection).toEqual({ kind: 'nodes', nodeIds: ['type.VM', 'type.UC'] })
    expect(backToOne.selection).toEqual({ kind: 'node', nodeId: 'type.UC' })
    expect(none.selection).toEqual({ kind: 'none' })
  })

  it('restores a viewpoint captured with an earlier answer', () => {
    const state = run(
      { type: 'enterScope', scopeId: 'pkg.Data' },
      { type: 'restore', viewpoint: { scopeId: 'mod.Screen', perspective: 'flow', flowId: 'flow.load', selection: { kind: 'node', nodeId: 'type.VM' } } },
    )

    expect(state).toMatchObject({ scopeId: 'mod.Screen', perspective: 'flow', selection: { kind: 'node', nodeId: 'type.VM' } })
    expect(state.trail.at(-1)).toEqual({ action: 'restore', scopeId: 'mod.Screen' })
  })

  it('keeps only the most recent trail steps', () => {
    const selects: ExplorationAction[] = Array.from({ length: TRAIL_LIMIT + 10 }, (_, i) => ({
      type: 'select',
      selection: { kind: 'node', nodeId: i % 2 === 0 ? 'pkg.Data' : 'pkg.Domain' },
    }))
    expect(run(...selects).trail).toHaveLength(TRAIL_LIMIT)
  })
})
