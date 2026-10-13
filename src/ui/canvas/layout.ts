import dagre from '@dagrejs/dagre'
import type { GraphView } from '../overlay'

/** Fixed sizes keep the layout independent of measured DOM sizes, so selection or zoom never causes a relayout. */
export const NODE_WIDTH = 232
export const NODE_HEIGHT = 120

export interface Position {
  x: number
  y: number
}

export interface Layout {
  positions: Map<string, Position>
  /**
   * Bend points for edges that span more than one rank. Without them an edge is drawn straight
   * through the nodes ranked in between and its label ends up hidden behind them.
   */
  bends: Map<string, Position[]>
}

/** Above this many nodes in one rank a ranked layout becomes a single unreadable column. */
const MAX_RANK_SIZE = 12

export function computeLayout(view: Pick<GraphView, 'nodes' | 'edges'>): Layout {
  try {
    const layout = dagreLayout(view)
    // Sibling modules that must not depend on each other (e.g. iOS Feature modules) all land in one
    // rank; a grid keeps them readable at the cost of rank order, which carries no meaning there.
    return largestRank(layout) > MAX_RANK_SIZE ? membersGridLayout(view) : layout
  } catch {
    // dagre can still fail on unusual shapes; a readable grid beats a blank screen.
    return gridLayout(view)
  }
}

function dagreLayout(view: Pick<GraphView, 'nodes' | 'edges'>): Layout {
  // A simple graph (one edge per ordered pair) rather than a multigraph: dagre's multigraph routing
  // throws "Not possible to find intersection inside of the rectangle" on dense views such as the
  // 80 feature modules of an iOS app, and parallel edges share the same route anyway.
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 110, marginx: 20, marginy: 20 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const node of view.nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const edge of view.edges) graph.setEdge(edge.source, edge.target)
  dagre.layout(graph)

  const positions = new Map<string, Position>()
  for (const node of view.nodes) {
    const laidOut = graph.node(node.id)
    positions.set(node.id, { x: laidOut.x - NODE_WIDTH / 2, y: laidOut.y - NODE_HEIGHT / 2 })
  }
  const bends = new Map<string, Position[]>()
  for (const edge of view.edges) {
    const points: Position[] = graph.edge(edge.source, edge.target)?.points ?? []
    // dagre gives [start, middle, end] for an edge between adjacent ranks; more points mean dummy
    // nodes were inserted to route around the ranks in between.
    if (points.length > 3) bends.set(edge.id, points.slice(1, -1).map(({ x, y }) => ({ x, y })))
  }
  return { positions, bends }
}

function largestRank(layout: Layout): number {
  const counts = new Map<number, number>()
  for (const { x } of layout.positions.values()) counts.set(x, (counts.get(x) ?? 0) + 1)
  return Math.max(0, ...counts.values())
}

/** Members in a grid, context nodes in a column to the right of it. */
function membersGridLayout(view: Pick<GraphView, 'nodes'>): Layout {
  const members = view.nodes.filter((node) => node.role === 'member')
  const context = view.nodes.filter((node) => node.role === 'context')
  const columns = Math.max(1, Math.ceil(Math.sqrt(members.length * 1.6)))
  const positions = new Map<string, Position>()
  members.forEach((node, i) => positions.set(node.id, { x: (i % columns) * (NODE_WIDTH + 40), y: Math.floor(i / columns) * (NODE_HEIGHT + 40) }))
  const contextX = columns * (NODE_WIDTH + 40) + 160
  context.forEach((node, i) => positions.set(node.id, { x: contextX, y: i * (NODE_HEIGHT + 40) }))
  return { positions, bends: new Map() }
}

function gridLayout(view: Pick<GraphView, 'nodes'>): Layout {
  const columns = Math.max(1, Math.ceil(Math.sqrt(view.nodes.length)))
  const positions = new Map<string, Position>()
  view.nodes.forEach((node, i) => positions.set(node.id, { x: (i % columns) * (NODE_WIDTH + 60), y: Math.floor(i / columns) * (NODE_HEIGHT + 60) }))
  return { positions, bends: new Map() }
}

/** A smooth SVG path through the points (Catmull-Rom converted to cubic Béziers). */
export function smoothPath(points: readonly Position[]): string {
  if (points.length < 2) return ''
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!
  let path = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    path += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`
  }
  return path
}

export function layoutKey(scopeId: string, perspective: string, flowId: string | null, aroundChanges: boolean): string {
  return `${scopeId}|${perspective}|${perspective === 'flow' ? flowId : ''}|${aroundChanges ? 'changes' : ''}`
}
