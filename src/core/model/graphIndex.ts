import { defaultLayers, type Flow, type GraphEdge, type GraphNode, type LayerDefinition, type ProjectGraph } from './graph'

export class GraphIntegrityError extends Error {}

/** Read-only lookups over a ProjectGraph. Construction fails loudly on dangling references. */
export class GraphIndex {
  readonly graph: ProjectGraph
  private readonly nodesById: Map<string, GraphNode>
  private readonly edgesById: Map<string, GraphEdge>
  private readonly flowsById: Map<string, Flow>
  private readonly childrenById: Map<string, GraphNode[]>
  private readonly layersById: Map<string, LayerDefinition>
  private readonly incomingById = new Map<string, GraphEdge[]>()
  private readonly outgoingById = new Map<string, GraphEdge[]>()
  // Paths are asked for on every projection and context build; with tens of thousands of nodes,
  // walking up the parents each time dominates the cost.
  private readonly pathCache = new Map<string, GraphNode[]>()
  private readonly changesWithinById = new Map<string, number>()

  constructor(graph: ProjectGraph) {
    this.graph = graph
    this.nodesById = uniqueMap(graph.nodes, 'node')
    this.edgesById = uniqueMap(graph.edges, 'edge')
    this.flowsById = uniqueMap(graph.flows, 'flow')
    this.childrenById = new Map()
    this.layersById = uniqueMap(graph.layers ?? defaultLayers, 'layer')

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
      push(this.outgoingById, edge.source, edge)
      push(this.incomingById, edge.target, edge)
    }
    for (const node of graph.nodes) {
      if (node.layer !== undefined && !this.layersById.has(node.layer)) {
        throw new GraphIntegrityError(`node ${node.id} refers to missing layer ${node.layer}`)
      }
    }
    for (const layer of this.layersById.values()) {
      for (const allowed of layer.mayDependOn) {
        if (!this.layersById.has(allowed)) throw new GraphIntegrityError(`layer ${layer.id} refers to missing layer ${allowed}`)
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
    for (const id of new Set(graph.changes?.nodeIds ?? [])) {
      for (const node of this.path(id)) this.changesWithinById.set(node.id, (this.changesWithinById.get(node.id) ?? 0) + 1)
    }
  }

  /** Changed declarations at or below the node, in the change set laid over the graph. */
  changesWithin(id: string): number {
    return this.changesWithinById.get(id) ?? 0
  }

  get hasChanges(): boolean {
    return this.changesWithinById.size > 0
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
    return this.path(id).slice(0, -1)
  }

  /** Root-to-node path including the node itself. */
  path(id: string): GraphNode[] {
    const cached = this.pathCache.get(id)
    if (cached) return cached
    const chain: GraphNode[] = [this.node(id)]
    const seen = new Set<string>([id])
    let current = chain[0]!
    while (current.parentId !== null) {
      if (seen.has(current.parentId)) throw new GraphIntegrityError(`containment cycle at ${current.parentId}`)
      seen.add(current.parentId)
      current = this.node(current.parentId)
      chain.unshift(current)
    }
    this.pathCache.set(id, chain)
    return chain
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
    return [...this.outgoing(id), ...this.incoming(id)]
  }

  incoming(id: string): readonly GraphEdge[] {
    return this.incomingById.get(id) ?? []
  }

  outgoing(id: string): readonly GraphEdge[] {
    return this.outgoingById.get(id) ?? []
  }

  /** The layer of the node or of its nearest ancestor that has one. */
  layerOf(id: string): LayerDefinition | null {
    for (const node of [...this.path(id)].reverse()) if (node.layer) return this.layersById.get(node.layer) ?? null
    return null
  }

  get layers(): LayerDefinition[] {
    return [...this.layersById.values()]
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

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
