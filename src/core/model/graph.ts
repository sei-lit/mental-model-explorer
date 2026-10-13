export type NodeKind = 'project' | 'package' | 'module' | 'type' | 'property' | 'method'

export type TypeFlavor = 'class' | 'struct' | 'protocol' | 'enum'

export type Layer = 'presentation' | 'domain' | 'data'

/**
 * A statement about the project. `observed` claims can be checked against the code;
 * `inferred` claims are someone's interpretation (design intent, responsibility).
 */
export interface Claim {
  text: string
  provenance: 'observed' | 'inferred'
  source?: string
}

export interface CodeSnippet {
  language: 'swift'
  path: string
  startLine: number
  text: string
}

export interface GraphNode {
  id: string
  kind: NodeKind
  name: string
  parentId: string | null
  aliases?: string[]
  flavor?: TypeFlavor
  layer?: Layer
  summary?: string
  responsibility?: Claim
  role?: Claim
  constraints?: Claim[]
  code?: CodeSnippet
}

export type RelationKind = 'depends_on' | 'implements' | 'calls' | 'observes' | 'creates' | 'passes_data'

export interface GraphEdge {
  id: string
  source: string
  target: string
  relation: RelationKind
  evidence: Claim
  rationale?: Claim
}

export interface FlowStep {
  edgeId: string
  note: string
  data?: string
}

export interface Flow {
  id: string
  name: string
  description: string
  trigger: string
  steps: FlowStep[]
}

export interface ProjectGraph {
  rootId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  flows: Flow[]
}
