import type { ViewEdge } from '../../core/exploration/projectView'
import type { Perspective } from '../../core/exploration/state'

/**
 * Above this many drawn edges a view is an unreadable mesh (e.g. 72 feature modules depending on
 * each other), so only the edges around what the user is looking at are drawn.
 */
export const FOCUS_MODE_EDGE_THRESHOLD = 40

/** The flow perspective already draws only the chosen flow's steps; hiding some would drop steps. */
export function usesFocusMode(perspective: Perspective, edges: readonly ViewEdge[]): boolean {
  return perspective !== 'flow' && edges.length > FOCUS_MODE_EDGE_THRESHOLD
}

export interface Focus {
  /** Selected and hovered nodes. */
  nodeIds: ReadonlySet<string>
  /** Graph edge ids of the selected edge. */
  selectedEdgeIds: readonly string[]
  /** Drawn edges an answer points at (highlights, trace steps, edges cut by a removal). */
  emphasizedEdgeIds: ReadonlySet<string>
}

export function edgesInFocus(edges: readonly ViewEdge[], focus: Focus): ViewEdge[] {
  return edges.filter(
    (edge) =>
      focus.nodeIds.has(edge.source) ||
      focus.nodeIds.has(edge.target) ||
      focus.emphasizedEdgeIds.has(edge.id) ||
      edge.edgeIds.some((id) => focus.selectedEdgeIds.includes(id)),
  )
}

export interface Partners {
  outgoing: number
  incoming: number
}

/** Distinct nodes each node points to and is pointed at by, so the amount of relations stays visible while edges are hidden. */
export function partnerCounts(edges: readonly ViewEdge[]): Map<string, Partners> {
  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, key: string, value: string) => map.set(key, (map.get(key) ?? new Set()).add(value))
  for (const edge of edges) {
    add(outgoing, edge.source, edge.target)
    add(incoming, edge.target, edge.source)
  }
  const counts = new Map<string, Partners>()
  for (const id of new Set([...outgoing.keys(), ...incoming.keys()])) {
    counts.set(id, { outgoing: outgoing.get(id)?.size ?? 0, incoming: incoming.get(id)?.size ?? 0 })
  }
  return counts
}
