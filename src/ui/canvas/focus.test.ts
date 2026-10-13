import { describe, expect, it } from 'vitest'
import type { ViewEdge } from '../../core/exploration/projectView'
import { edgesInFocus, FOCUS_MODE_EDGE_THRESHOLD, partnerCounts, usesFocusMode } from './focus'

function edge(source: string, target: string, edgeIds = [`${source}->${target}`]): ViewEdge {
  return { id: `${source}|depends_on|${target}`, source, target, relation: 'depends_on', edgeIds, aggregated: false, inferred: false, flowSteps: [], concerns: [] }
}

const noFocus = { nodeIds: new Set<string>(), selectedEdgeIds: [], emphasizedEdgeIds: new Set<string>() }

describe('usesFocusMode', () => {
  const many = Array.from({ length: FOCUS_MODE_EDGE_THRESHOLD + 1 }, (_, i) => edge(`a${i}`, `b${i}`))

  it('turns on when a view has more edges than can be read', () => {
    expect(usesFocusMode('structure', many)).toBe(true)
    expect(usesFocusMode('structure', many.slice(0, FOCUS_MODE_EDGE_THRESHOLD))).toBe(false)
  })

  it('never hides steps of a flow', () => {
    expect(usesFocusMode('flow', many)).toBe(false)
  })
})

describe('edgesInFocus', () => {
  const edges = [edge('A', 'B'), edge('B', 'C'), edge('C', 'D', ['c1', 'c2'])]

  it('draws nothing when nothing is focused', () => {
    expect(edgesInFocus(edges, noFocus)).toEqual([])
  })

  it('draws the edges of a focused node in both directions', () => {
    expect(edgesInFocus(edges, { ...noFocus, nodeIds: new Set(['B']) }).map((e) => e.id)).toEqual(['A|depends_on|B', 'B|depends_on|C'])
  })

  it('keeps the selected edge and the edges an answer points at', () => {
    const shown = edgesInFocus(edges, { ...noFocus, selectedEdgeIds: ['c2'], emphasizedEdgeIds: new Set(['A|depends_on|B']) })
    expect(shown.map((e) => e.id)).toEqual(['A|depends_on|B', 'C|depends_on|D'])
  })
})

describe('partnerCounts', () => {
  it('counts distinct partners, not underlying edges', () => {
    const counts = partnerCounts([edge('A', 'B', ['1', '2', '3']), { ...edge('A', 'B'), id: 'A|calls|B', relation: 'calls' }, edge('C', 'A')])
    expect(counts.get('A')).toEqual({ outgoing: 1, incoming: 1 })
    expect(counts.get('B')).toEqual({ outgoing: 0, incoming: 1 })
  })
})
