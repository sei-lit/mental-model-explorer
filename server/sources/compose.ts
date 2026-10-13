import type { ProjectGraph } from '../../src/core/model/graph'

export interface ProjectPart {
  graph: ProjectGraph
  /** Shown as the part's node name, e.g. "KMP (Kotlin)". */
  label: string
}

/**
 * Puts several analysed projects (e.g. the Kotlin modules and the Swift package of one repository)
 * under one root, so questions can follow relations across them. Each part keeps its ids, which the
 * sources prefix to stay unique; GraphIndex rejects the result if they collide.
 */
export function composeProjects(rootName: string, parts: readonly ProjectPart[]): ProjectGraph {
  if (parts.length === 1) return parts[0]!.graph
  const rootId = 'root'
  return {
    rootId,
    layers: parts.flatMap((part) => part.graph.layers ?? []),
    nodes: [
      { id: rootId, kind: 'project', name: rootName, parentId: null, summary: parts.map((part) => part.label).join(' と ') + ' からなるリポジトリ。' },
      ...parts.flatMap(({ graph, label }) =>
        graph.nodes.map((node) => (node.id === graph.rootId ? { ...node, kind: 'package' as const, name: label, parentId: rootId } : node)),
      ),
    ],
    edges: parts.flatMap((part) => part.graph.edges),
    flows: parts.flatMap((part) => part.graph.flows),
  }
}
