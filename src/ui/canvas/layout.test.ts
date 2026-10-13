import { describe, expect, it } from 'vitest'
import { computeLayout, smoothPath } from './layout'
import type { ViewEdge, ViewNode } from '../../core/exploration/projectView'

const viewNode = (id: string) => ({ id }) as ViewNode
const viewEdge = (id: string, source: string, target: string) => ({ id, source, target }) as ViewEdge

describe('computeLayout', () => {
  it('routes an edge that skips a rank around the node in between', () => {
    const layout = computeLayout({
      nodes: [viewNode('a'), viewNode('b'), viewNode('c')],
      edges: [viewEdge('ab', 'a', 'b'), viewEdge('bc', 'b', 'c'), viewEdge('ac', 'a', 'c')],
    })

    expect(layout.bends.has('ab')).toBe(false)
    expect(layout.bends.get('ac')?.length).toBeGreaterThan(0)
  })
})

describe('smoothPath', () => {
  it('starts at the first point and ends at the last', () => {
    const path = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }])

    expect(path.startsWith('M 0 0')).toBe(true)
    expect(path.endsWith('20 0')).toBe(true)
    expect(path.match(/C/g)).toHaveLength(2)
  })
})
