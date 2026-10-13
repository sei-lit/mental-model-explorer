import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../model/graphIndex'
import { miniGraph } from '../testing/miniGraph'
import { simulateRemoval } from './whatIf'

const index = new GraphIndex(miniGraph())
const sorted = (ids: string[]) => [...ids].sort()

describe('simulateRemoval', () => {
  it('removes the node together with everything it contains', () => {
    expect(sorted(simulateRemoval(index, ['type.Repo']).removedNodeIds)).toEqual(['method.Repo.fetch', 'type.Repo'])
  })

  it('marks users of the removed protocol, including its implementation, as directly affected', () => {
    const impact = simulateRemoval(index, ['type.Repo'])

    expect(sorted(impact.directlyAffectedIds)).toEqual(['type.Impl', 'type.UC'])
    expect(sorted(impact.brokenEdgeIds)).toEqual(['c.exec-fetch', 'c.fetch-impl', 'e.impl-repo', 'e.uc-repo'])
  })

  it('propagates through users of the affected nodes', () => {
    expect(sorted(simulateRemoval(index, ['type.Repo']).transitivelyAffectedIds)).toEqual(['type.VM', 'type.View'])
  })

  it('does not mark an implementation as affected only because users of its protocol are', () => {
    const impact = simulateRemoval(index, ['type.UC'])

    expect(impact.directlyAffectedIds).toEqual(['type.VM'])
    expect(impact.transitivelyAffectedIds).toEqual(['type.View'])
  })

  it('reports affected elements at type granularity rather than individual methods', () => {
    const impact = simulateRemoval(index, ['method.GW.get'])

    expect(impact.directlyAffectedIds).toEqual(['type.Impl'])
  })

  it('treats removing a whole package as removing everything inside it', () => {
    const impact = simulateRemoval(index, ['pkg.Data'])

    expect(impact.removedNodeIds).toEqual(expect.arrayContaining(['type.Impl', 'type.GW', 'method.GW.get']))
    expect(sorted(impact.directlyAffectedIds)).toEqual(['type.Repo', 'type.VM'])
  })
})
