import dagre from '@dagrejs/dagre'
import type { GraphView } from '../overlay'

/** Fixed sizes keep the layout independent of measured DOM sizes, so selection or zoom never causes a relayout. */
export const NODE_WIDTH = 232
export const NODE_HEIGHT = 120

export interface Position {
  x: number
  y: number
}

export function computeLayout(view: Pick<GraphView, 'nodes' | 'edges'>): Map<string, Position> {
  const graph = new dagre.graphlib.Graph({ multigraph: true })
  graph.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 110, marginx: 20, marginy: 20 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of view.nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const edge of view.edges) graph.setEdge(edge.source, edge.target, {}, edge.id)
  dagre.layout(graph)

  const positions = new Map<string, Position>()
  for (const node of view.nodes) {
    const laidOut = graph.node(node.id)
    positions.set(node.id, { x: laidOut.x - NODE_WIDTH / 2, y: laidOut.y - NODE_HEIGHT / 2 })
  }
  return positions
}

export function layoutKey(scopeId: string, perspective: string, flowId: string | null): string {
  return `${scopeId}|${perspective}|${perspective === 'flow' ? flowId : ''}`
}
