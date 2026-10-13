import type { GraphEdge, GraphNode, LayerDefinition, RelationKind } from '../model/graph'
import type { GraphIndex } from '../model/graphIndex'
import type { Perspective, Viewpoint } from './state'

export type ViewNodeRole = 'member' | 'context'

export interface ViewNode {
  id: string
  node: GraphNode
  /** `member` = a child of the current scope; `context` = something outside the scope that members connect to. */
  role: ViewNodeRole
  childCount: number
  layer: LayerDefinition | null
  /** Only in the flow perspective: whether the node takes part in the selected flow. */
  inFlow: boolean
}

export type EdgeConcern = 'layerViolation'

export interface ViewEdge {
  id: string
  source: string
  target: string
  relation: RelationKind
  /** Real graph edges this drawn edge stands for. More than one means the edge is aggregated. */
  edgeIds: string[]
  aggregated: boolean
  /** True when every underlying edge is only inferred (e.g. calls found by static analysis), so the UI can draw it as tentative. */
  inferred: boolean
  /** 1-based step numbers of the selected flow that this edge carries. */
  flowSteps: number[]
  concerns: EdgeConcern[]
}

export type VisibleView =
  | { mode: 'graph'; scopeId: string; nodes: ViewNode[]; edges: ViewEdge[] }
  | { mode: 'code'; scopeId: string; node: GraphNode; callers: GraphEdge[]; callees: GraphEdge[] }

const relationsByPerspective: Record<Exclude<Perspective, 'flow'>, ReadonlySet<RelationKind>> = {
  structure: new Set(['depends_on', 'implements', 'creates', 'observes']),
  responsibility: new Set(['depends_on', 'implements']),
}

/**
 * Projects the graph onto what the current viewpoint shows. The scope decides the granularity
 * (semantic zoom): members are the scope's children, and every graph edge is lifted to the
 * members/context nodes that contain its endpoints.
 */
export function projectView(index: GraphIndex, viewpoint: Viewpoint): VisibleView {
  const scope = index.node(viewpoint.scopeId)
  const members = index.children(scope.id)
  if (members.length === 0) {
    return {
      mode: 'code',
      scopeId: scope.id,
      node: scope,
      callers: index.graph.edges.filter((edge) => edge.target === scope.id && edge.relation === 'calls'),
      callees: index.graph.edges.filter((edge) => edge.source === scope.id && edge.relation === 'calls'),
    }
  }

  const flow = viewpoint.perspective === 'flow' && viewpoint.flowId ? index.flow(viewpoint.flowId) : null
  const candidates = candidateEdges(index, viewpoint)

  const contextNodes = new Map<string, GraphNode>()
  const viewEdges = new Map<string, ViewEdge>()
  for (const { edge, step } of candidates) {
    const source = representative(index, scope.id, edge.source)
    const target = representative(index, scope.id, edge.target)
    if (!source || !target || source.node.id === target.node.id) continue
    if (source.role === 'context' && target.role === 'context') continue
    for (const end of [source, target]) if (end.role === 'context') contextNodes.set(end.node.id, end.node)

    const id = `${source.node.id}|${edge.relation}|${target.node.id}`
    const existing = viewEdges.get(id)
    const viewEdge: ViewEdge = existing ?? {
      id,
      source: source.node.id,
      target: target.node.id,
      relation: edge.relation,
      edgeIds: [],
      aggregated: false,
      inferred: true,
      flowSteps: [],
      concerns: [],
    }
    if (!viewEdge.edgeIds.includes(edge.id)) viewEdge.edgeIds.push(edge.id)
    if (step !== null) viewEdge.flowSteps.push(step)
    if (edge.evidence.provenance === 'observed') viewEdge.inferred = false
    viewEdge.aggregated = viewEdge.edgeIds.length > 1 || viewEdge.source !== edge.source || viewEdge.target !== edge.target
    if (crossesLayerWrongly(index, edge) && !viewEdge.concerns.includes('layerViolation')) viewEdge.concerns.push('layerViolation')
    viewEdges.set(id, viewEdge)
  }

  const flowNodeIds = new Set([...viewEdges.values()].flatMap((edge) => [edge.source, edge.target]))
  const toViewNode = (node: GraphNode, role: ViewNodeRole): ViewNode => ({
    id: node.id,
    node,
    role,
    childCount: index.children(node.id).length,
    layer: index.layerOf(node.id),
    inFlow: flow ? flowNodeIds.has(node.id) : false,
  })

  return {
    mode: 'graph',
    scopeId: scope.id,
    nodes: [...members.map((node) => toViewNode(node, 'member')), ...[...contextNodes.values()].map((node) => toViewNode(node, 'context'))],
    edges: [...viewEdges.values()],
  }
}

function candidateEdges(index: GraphIndex, viewpoint: Viewpoint): { edge: GraphEdge; step: number | null }[] {
  if (viewpoint.perspective === 'flow') {
    if (!viewpoint.flowId) return []
    return index.flow(viewpoint.flowId).steps.map((step, i) => ({ edge: index.edge(step.edgeId), step: i + 1 }))
  }
  const relations = relationsByPerspective[viewpoint.perspective]
  return index.graph.edges.filter((edge) => relations.has(edge.relation)).map((edge) => ({ edge, step: null }))
}

/**
 * Inside the scope a node is represented by the scope's child that contains it. Outside the scope it is
 * represented at the level where its path leaves the scope's path (e.g. the sibling module or the other
 * package), so context nodes appear at a granularity comparable to the members.
 */
function representative(index: GraphIndex, scopeId: string, nodeId: string): { node: GraphNode; role: ViewNodeRole } | null {
  if (index.isWithin(nodeId, scopeId)) {
    const member = index.childOfScopeContaining(scopeId, nodeId)
    return member ? { node: member, role: 'member' } : null
  }
  const scopePath = index.path(scopeId)
  const nodePath = index.path(nodeId)
  let divergence = 0
  while (scopePath[divergence]?.id === nodePath[divergence]?.id) divergence++
  const node = nodePath[divergence]
  return node ? { node, role: 'context' } : null
}

export function crossesLayerWrongly(index: GraphIndex, edge: GraphEdge): boolean {
  if (edge.relation !== 'depends_on' && edge.relation !== 'implements') return false
  const from = index.layerOf(edge.source)
  const to = index.layerOf(edge.target)
  // Layers of different systems (e.g. Swift code using a Kotlin module) have no rule between them.
  if (!from || !to || from.system !== to.system) return false
  return !from.mayDependOn.includes(to.id)
}
