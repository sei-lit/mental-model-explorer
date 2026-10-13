import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../model/graphIndex'
import { miniGraph } from '../testing/miniGraph'
import { projectView, type VisibleView } from './projectView'
import { noSelection, type Viewpoint } from './state'

const index = new GraphIndex(miniGraph())
const at = (scopeId: string, extra: Partial<Viewpoint> = {}): Viewpoint => ({ scopeId, perspective: 'structure', flowId: 'flow.load', selection: noSelection, ...extra })

function graphView(view: VisibleView) {
  if (view.mode !== 'graph') throw new Error('expected graph mode')
  return view
}

describe('projectView', () => {
  it('shows packages at the project scope and lifts type-level edges between them', () => {
    const view = graphView(projectView(index, at('project')))

    expect(view.nodes.map((node) => node.id)).toEqual(['pkg.Feature', 'pkg.Domain', 'pkg.Data'])
    const featureToDomain = view.edges.find((edge) => edge.id === 'pkg.Feature|depends_on|pkg.Domain')
    expect(featureToDomain).toMatchObject({ edgeIds: ['e.vm-uc'], aggregated: true })
  })

  it('drops edges whose endpoints fall into the same member', () => {
    const view = graphView(projectView(index, at('project')))

    expect(view.edges.every((edge) => edge.source !== edge.target)).toBe(true)
    expect(view.edges.flatMap((edge) => edge.edgeIds)).not.toContain('e.view-vm')
  })

  it('flags a dependency that goes against the layer direction', () => {
    const view = graphView(projectView(index, at('project')))

    expect(view.edges.find((edge) => edge.id === 'pkg.Feature|depends_on|pkg.Data')?.concerns).toEqual(['layerViolation'])
    expect(view.edges.find((edge) => edge.id === 'pkg.Data|implements|pkg.Domain')?.concerns).toEqual([])
  })

  it('uses the layer rules that come with the graph', () => {
    const graph = miniGraph()
    graph.layers = [
      { id: 'presentation', label: 'P', system: 's', mayDependOn: ['presentation', 'domain', 'data'] },
      { id: 'domain', label: 'D', system: 's', mayDependOn: ['domain'] },
      { id: 'data', label: 'Data', system: 's', mayDependOn: ['data', 'domain'] },
    ]
    const view = graphView(projectView(new GraphIndex(graph), at('project')))

    expect(view.edges.find((edge) => edge.id === 'pkg.Feature|depends_on|pkg.Data')?.concerns).toEqual([])
  })

  it('does not judge dependencies between layers of different systems', () => {
    const graph = miniGraph()
    graph.layers = [
      { id: 'presentation', label: 'P', system: 'swift', mayDependOn: ['presentation'] },
      { id: 'domain', label: 'D', system: 'kotlin', mayDependOn: ['domain'] },
      { id: 'data', label: 'Data', system: 'kotlin', mayDependOn: ['data'] },
    ]
    const view = graphView(projectView(new GraphIndex(graph), at('project')))

    expect(view.edges.find((edge) => edge.id === 'pkg.Feature|depends_on|pkg.Domain')?.concerns).toEqual([])
    expect(view.edges.find((edge) => edge.id === 'pkg.Data|implements|pkg.Domain')?.concerns).toEqual(['layerViolation'])
  })

  it('represents outside nodes at the level where their path leaves the scope', () => {
    const view = graphView(projectView(index, at('mod.Impl')))

    expect(view.nodes.filter((node) => node.role === 'member').map((node) => node.id)).toEqual(['type.Impl'])
    expect(view.nodes.filter((node) => node.role === 'context').map((node) => node.id).sort()).toEqual(['mod.Gateway', 'pkg.Domain'])
  })

  it('keeps the same members but filters relations by perspective', () => {
    const structure = graphView(projectView(index, at('mod.Screen')))
    const responsibility = graphView(projectView(index, at('mod.Screen', { perspective: 'responsibility' })))

    expect(responsibility.nodes.filter((n) => n.role === 'member')).toEqual(structure.nodes.filter((n) => n.role === 'member'))
    expect(structure.edges.map((edge) => edge.relation)).toContain('observes')
    expect(responsibility.edges.map((edge) => edge.relation)).not.toContain('observes')
  })

  it('shows only the selected flow, numbered by step, in the flow perspective', () => {
    const view = graphView(projectView(index, at('project', { perspective: 'flow' })))

    expect(view.edges.map((edge) => [edge.id, edge.flowSteps])).toEqual([
      ['pkg.Feature|calls|pkg.Domain', [1]],
      ['pkg.Domain|calls|pkg.Data', [3]],
    ])
    expect(view.nodes.every((node) => node.inFlow)).toBe(true)
  })

  it('switches to code mode when the scope is a method', () => {
    const view = projectView(index, at('method.UC.exec'))

    expect(view).toMatchObject({ mode: 'code', scopeId: 'method.UC.exec' })
    if (view.mode !== 'code') throw new Error('expected code mode')
    expect(view.callers.map((edge) => edge.id)).toEqual(['c.load-exec'])
    expect(view.callees.map((edge) => edge.id)).toEqual(['c.exec-fetch'])
  })
})
