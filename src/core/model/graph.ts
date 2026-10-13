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

/** Where a declaration is written, with its full line range (`code.text` is a capped excerpt). */
export interface SourceSpan {
  path: string
  startLine: number
  endLine: number
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
  /** Several for a Swift type spread over extensions. Used to find the declarations a diff touches. */
  spans?: SourceSpan[]
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

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/** A pull request (or a diff against a base) laid over the graph, so it can be explored and asked about. */
export interface ChangeSet {
  title: string
  url: string | null
  /** Excerpt of the PR description. */
  description: string
  base: string
  /** The most specific declarations whose lines the diff touches. */
  nodeIds: string[]
  files: { path: string; status: FileChangeStatus; nodeIds: string[] }[]
  /** Why the change set may not match the analysed code (e.g. HEAD is not the PR's head). */
  warnings: string[]
}

export interface ProjectGraph {
  rootId: string
  /** Without it the clean-architecture layers presentation → domain ← data are assumed. */
  layers?: LayerDefinition[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  flows: Flow[]
  changes?: ChangeSet
}

export const defaultLayers: LayerDefinition[] = [
  { id: 'presentation', label: 'Presentation', system: 'default', mayDependOn: ['presentation', 'domain'] },
  { id: 'domain', label: 'Domain', system: 'default', mayDependOn: ['domain'] },
  { id: 'data', label: 'Data', system: 'default', mayDependOn: ['data', 'domain'] },
]
