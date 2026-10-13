import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../../core/model/graphIndex'
import { bookShelfGraph, bookShelfSource } from './bookShelf'

describe('bookShelfGraph', () => {
  it('passes GraphIndex integrity checks', () => {
    expect(() => new GraphIndex(bookShelfGraph)).not.toThrow()
  })

  it('gives every method node a code snippet', () => {
    const methods = bookShelfGraph.nodes.filter((n) => n.kind === 'method')
    expect(methods.length).toBeGreaterThan(0)
    expect(methods.filter((n) => !n.code).map((n) => n.id)).toEqual([])
  })

  it('gives every type, module and package a responsibility', () => {
    const owners = bookShelfGraph.nodes.filter((n) => ['type', 'module', 'package'].includes(n.kind))
    expect(owners.filter((n) => !n.responsibility).map((n) => n.id)).toEqual([])
  })

  it('has flows with at least four steps', () => {
    expect(bookShelfGraph.flows.length).toBeGreaterThanOrEqual(3)
    for (const flow of bookShelfGraph.flows) expect(flow.steps.length).toBeGreaterThanOrEqual(4)
  })

  it('has a depends_on edge with rationale from the repository implementation to the API gateway', () => {
    const found = bookShelfGraph.edges.find(
      (e) => e.source === 'type.BookRepositoryImpl' && e.target === 'type.BookAPIGateway' && e.relation === 'depends_on',
    )
    expect(found?.rationale).toBeDefined()
  })

  it('exposes a source that loads the graph', async () => {
    await expect(bookShelfSource.load()).resolves.toBe(bookShelfGraph)
  })
})
