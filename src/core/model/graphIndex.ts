import type { Flow, GraphEdge, GraphNode, ProjectGraph } from './graph'

export class GraphIntegrityError extends Error {}

/** Read-only lookups over a ProjectGraph. Construction fails loudly on dangling references. */
export class GraphIndex {
  readonly graph: ProjectGraph
  private readonly nodesById: Map<string, GraphNode>
  private readonly edgesById: Map<string, GraphEdge>
  private readonly flowsById: Map<string, Flow>
  private readonly childrenById: Map<string, GraphNode[]>

  constructor(graph: ProjectGraph) {
    this.graph = graph
    this.nodesById = uniqueMap(graph.nodes, 'node')
    this.edgesById = uniqueMap(graph.edges, 'edge')
    this.flowsById = uniqueMap(graph.flows, 'flow')
    this.childrenById = new Map()

    if (!this.nodesById.has(graph.rootId)) throw new GraphIntegrityError(`root ${graph.rootId} does not exist`)
    for (const node of graph.nodes) {
      if (node.parentId === null) {
        if (node.id !== graph.rootId) throw new GraphIntegrityError(`node ${node.id} has no parent but is not the root`)
        continue
      }
      if (!this.nodesById.has(node.parentId)) {
        throw new GraphIntegrityError(`node ${node.id} refers to missing parent ${node.parentId}`)
      }
      const siblings = this.childrenById.get(node.parentId) ?? []
      siblings.push(node)
      this.childrenById.set(node.parentId, siblings)
    }
    for (const edge of graph.edges) {
      for (const end of [edge.source, edge.target]) {
        if (!this.nodesById.has(end)) throw new GraphIntegrityError(`edge ${edge.id} refers to missing node ${end}`)
      }
    }
    for (const flow of graph.flows) {
      for (const step of flow.steps) {
        if (!this.edgesById.has(step.edgeId)) {
          throw new GraphIntegrityError(`flow ${flow.id} refers to missing edge ${step.edgeId}`)
        }
      }
    }
    for (const node of graph.nodes) this.ancestors(node.id)
  }

  get root(): GraphNode {
    return this.node(this.graph.rootId)
  }

  hasNode(id: string): boolean {
    return this.nodesById.has(id)
  }

  hasEdge(id: string): boolean {
    return this.edgesById.has(id)
  }

  node(id: string): GraphNode {
    const node = this.nodesById.get(id)
    if (!node) throw new GraphIntegrityError(`unknown node ${id}`)
    return node
  }

  edge(id: string): GraphEdge {
    const edge = this.edgesById.get(id)
    if (!edge) throw new GraphIntegrityError(`unknown edge ${id}`)
    return edge
  }

  flow(id: string): Flow {
    const flow = this.flowsById.get(id)
    if (!flow) throw new GraphIntegrityError(`unknown flow ${id}`)
    return flow
  }

  children(id: string): readonly GraphNode[] {
    return this.childrenById.get(id) ?? []
  }

  /** Ancestors from the root down to the direct parent (excludes the node itself). */
  ancestors(id: string): GraphNode[] {
    const chain: GraphNode[] = []
    const seen = new Set<string>([id])
    let current = this.node(id)
    while (current.parentId !== null) {
      if (seen.has(current.parentId)) throw new GraphIntegrityError(`containment cycle at ${current.parentId}`)
      seen.add(current.parentId)
      current = this.node(current.parentId)
      chain.unshift(current)
    }
    return chain
  }

  /** Root-to-node path including the node itself. */
  path(id: string): GraphNode[] {
    return [...this.ancestors(id), this.node(id)]
  }

  isWithin(id: string, containerId: string): boolean {
    return id === containerId || this.ancestors(id).some((ancestor) => ancestor.id === containerId)
  }

  /** The direct child of `scopeId` that contains `id`, or null when `id` is outside the scope or is the scope. */
  childOfScopeContaining(scopeId: string, id: string): GraphNode | null {
    const path = this.path(id)
    const scopeIndex = path.findIndex((node) => node.id === scopeId)
    if (scopeIndex === -1) return null
    return path[scopeIndex + 1] ?? null
  }

  edgesTouching(id: string): GraphEdge[] {
    return this.graph.edges.filter((edge) => edge.source === id || edge.target === id)
  }
}

function uniqueMap<T extends { id: string }>(items: readonly T[], label: string): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    if (map.has(item.id)) throw new GraphIntegrityError(`duplicate ${label} id ${item.id}`)
    map.set(item.id, item)
  }
  return map
}
