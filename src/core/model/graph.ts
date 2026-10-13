/**
 * `package` groups modules (a layer or a Swift package); `namespace` is a language-level package
 * inside a module (e.g. a Kotlin package), which large modules need to stay explorable.
 */
export type NodeKind = 'project' | 'package' | 'module' | 'namespace' | 'type' | 'property' | 'method'

export type TypeFlavor = 'class' | 'struct' | 'protocol' | 'interface' | 'object' | 'enum'

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
  language: 'swift' | 'kotlin'
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
  /**
   * Which layers each layer may depend on. Projects differ (e.g. a use-case implementation layer that
   * may see repositories), so the rule travels with the graph; without it the clean-architecture
   * direction presentation → domain ← data is assumed.
   */
  layerRules?: Record<Layer, Layer[]>
  nodes: GraphNode[]
  edges: GraphEdge[]
  flows: Flow[]
}
