import { describe, expect, it } from 'vitest'
import { miniGraph } from '../testing/miniGraph'
import { GraphIndex, GraphIntegrityError } from './graphIndex'

describe('GraphIndex', () => {
  it('rejects a node whose parent does not exist', () => {
    const graph = miniGraph()
    graph.nodes.push({ id: 'type.Orphan', kind: 'type', name: 'Orphan', parentId: 'mod.Missing' })
    expect(() => new GraphIndex(graph)).toThrow(GraphIntegrityError)
  })

  it('rejects an edge that points at a missing node', () => {
    const graph = miniGraph()
    graph.edges.push({ id: 'e.bad', source: 'type.VM', target: 'type.Missing', relation: 'depends_on', evidence: { text: '', provenance: 'observed' } })
    expect(() => new GraphIndex(graph)).toThrow(/missing node type.Missing/)
  })

  it('rejects a flow step that points at a missing edge', () => {
    const graph = miniGraph()
    graph.flows[0]!.steps.push({ edgeId: 'e.missing', note: '' })
    expect(() => new GraphIndex(graph)).toThrow(/missing edge e.missing/)
  })

  it('rejects duplicate ids', () => {
    const graph = miniGraph()
    graph.nodes.push({ ...graph.nodes[1]! })
    expect(() => new GraphIndex(graph)).toThrow(/duplicate node/)
  })

  it('rejects a containment cycle', () => {
    const graph = miniGraph()
    const feature = graph.nodes.find((node) => node.id === 'pkg.Feature')!
    feature.parentId = 'mod.Screen'
    expect(() => new GraphIndex(graph)).toThrow(GraphIntegrityError)
  })

  it('finds the direct child of a scope that contains a deep node', () => {
    const index = new GraphIndex(miniGraph())
    expect(index.childOfScopeContaining('project', 'method.VM.load')?.id).toBe('pkg.Feature')
    expect(index.childOfScopeContaining('mod.Screen', 'method.VM.load')?.id).toBe('type.VM')
    expect(index.childOfScopeContaining('pkg.Data', 'method.VM.load')).toBeNull()
    expect(index.childOfScopeContaining('type.VM', 'type.VM')).toBeNull()
  })
})
