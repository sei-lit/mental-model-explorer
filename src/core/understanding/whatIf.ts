import type { RelationKind } from '../model/graph'
import type { GraphIndex } from '../model/graphIndex'

export interface RemovalImpact {
  /** The named nodes and everything they contain. */
  removedNodeIds: string[]
  /** Edges that lose an endpoint. */
  brokenEdgeIds: string[]
  /** Nodes outside the removal that use a removed node directly. */
  directlyAffectedIds: string[]
  /** Nodes that reach a directly affected node through further dependencies. */
  transitivelyAffectedIds: string[]
}

/** Relations along which a breakage propagates back to the user of the relation. */
const propagatingRelations: ReadonlySet<RelationKind> = new Set(['depends_on', 'implements', 'calls', 'observes', 'creates', 'passes_data'])

/**
 * Structural impact only: which elements lose something they reference. It does not know about
 * runtime behaviour such as dynamic dispatch fallbacks, so the UI presents it as a structural estimate.
 */
export function simulateRemoval(index: GraphIndex, nodeIds: readonly string[]): RemovalImpact {
  const removed = new Set(index.graph.nodes.filter((node) => nodeIds.some((id) => index.isWithin(node.id, id))).map((node) => node.id))
  const brokenEdges = index.graph.edges.filter((edge) => removed.has(edge.source) || removed.has(edge.target))

  // Affected elements are reported at type granularity or coarser: a method that loses a callee
  // means its owning type is affected, which is what the user sees on the canvas.
  const owner = (id: string) => {
    const node = index.node(id)
    return node.kind === 'method' || node.kind === 'property' ? (node.parentId ?? id) : id
  }

  const direct = new Set<string>()
  for (const edge of brokenEdges) {
    if (!propagatingRelations.has(edge.relation)) continue
    if (removed.has(edge.target) && !removed.has(edge.source)) {
      const ownerId = owner(edge.source)
      if (!removed.has(ownerId)) direct.add(ownerId)
    }
  }

  const transitive = new Set<string>()
  const queue = [...direct]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of index.graph.edges) {
      // An implementation is not broken because a protocol's other users are; only a removed
      // protocol (handled as a direct impact above) breaks its implementations.
      if (!propagatingRelations.has(edge.relation) || edge.relation === 'implements') continue
      if (owner(edge.target) !== current) continue
      const user = owner(edge.source)
      if (removed.has(user) || direct.has(user) || transitive.has(user)) continue
      transitive.add(user)
      queue.push(user)
    }
  }

  return {
    removedNodeIds: [...removed],
    brokenEdgeIds: brokenEdges.map((edge) => edge.id),
    directlyAffectedIds: [...direct],
    transitivelyAffectedIds: [...transitive],
  }
}
