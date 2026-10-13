/**
 * `package` groups modules (a layer or a Swift package); `namespace` is a language-level package
 * inside a module (e.g. a Kotlin package), which large modules need to stay explorable.
 */
export type NodeKind = 'project' | 'package' | 'module' | 'namespace' | 'type' | 'property' | 'method'

/** `extension` stands for extensions of a type declared outside the project (e.g. SwiftUI's View). */
export type TypeFlavor = 'class' | 'struct' | 'protocol' | 'interface' | 'object' | 'enum' | 'actor' | 'extension'

/**
 * An architectural layer as a project defines it. Projects use different layer systems (a three-layer
 * Kotlin module set next to a seven-layer Swift package), so layers are only compared within one `system`.
 */
export interface LayerDefinition {
  id: string
  label: string
  system: string
  /** Layers of the same system this one may depend on, including itself when same-layer dependencies are allowed. */
  mayDependOn: string[]
}

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
  /** Id of a LayerDefinition; descendants inherit it. */
  layer?: string
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
  /** Without it the clean-architecture layers presentation → domain ← data are assumed. */
  layers?: LayerDefinition[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  flows: Flow[]
}

export const defaultLayers: LayerDefinition[] = [
  { id: 'presentation', label: 'Presentation', system: 'default', mayDependOn: ['presentation', 'domain'] },
  { id: 'domain', label: 'Domain', system: 'default', mayDependOn: ['domain'] },
  { id: 'data', label: 'Data', system: 'default', mayDependOn: ['data', 'domain'] },
]
