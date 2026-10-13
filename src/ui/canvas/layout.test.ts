import { describe, expect, it } from 'vitest'
import { computeLayout, smoothPath } from './layout'
import type { ViewEdge, ViewNode } from '../../core/exploration/projectView'

const viewNode = (id: string, role: ViewNode['role'] = 'member') => ({ id, role }) as ViewNode
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

describe('computeLayout with parallel and opposite edges', () => {
  it('lays out every node when several relations connect the same pair in both directions', () => {
    const layout = computeLayout({
      nodes: [viewNode('a'), viewNode('b'), viewNode('c')],
      edges: [viewEdge('ab1', 'a', 'b'), viewEdge('ab2', 'a', 'b'), viewEdge('ba', 'b', 'a'), viewEdge('ac', 'a', 'c'), viewEdge('bc', 'b', 'c')],
    })

    expect([...layout.positions.keys()].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('computeLayout for many unrelated siblings', () => {
  it('arranges the members in a grid with context nodes to the right instead of one tall column', () => {
    const members = Array.from({ length: 30 }, (_, i) => viewNode(`m${i}`))
    const layout = computeLayout({
      nodes: [...members, viewNode('ctx', 'context')],
      edges: members.map((member) => viewEdge(`e-${member.id}`, member.id, 'ctx')),
    })
    const memberXs = new Set(members.map((member) => layout.positions.get(member.id)!.x))
    const rightmostMember = Math.max(...memberXs)

    expect(memberXs.size).toBeGreaterThan(1)
    expect(layout.positions.get('ctx')!.x).toBeGreaterThan(rightmostMember)
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
