import type { Claim, GraphEdge, GraphNode, NodeKind } from '../model/graph'
import type { GraphIndex } from '../model/graphIndex'
import { layerOf, projectView, type VisibleView } from '../exploration/projectView'
import type { ExplorationState, Perspective, TrailStep, Viewpoint } from '../exploration/state'
import { describeTarget, type QuestionTarget } from './target'
import { simulateRemoval } from './whatIf'

/**
 * How much of the UI state is sent with a question. The limits keep the context focused on the
 * subject: the full exploration log and the whole graph are deliberately not sent.
 */
export const contextBudget = {
  visibleNodes: 40,
  visibleEdges: 60,
  nearbyRelations: 15,
  trailSteps: 6,
  memberList: 12,
  usedBy: 12,
  relationsPerNode: 12,
  aggregatedExamples: 8,
  codeContextLines: 3,
} as const

export interface NodeBrief {
  id: string
  name: string
  kind: NodeKind
  path: string
  layer: string | null
  summary: string | null
}

export interface RelationBrief {
  id: string
  source: { id: string; name: string }
  target: { id: string; name: string }
  relation: GraphEdge['relation']
  evidence: Claim
  rationale: Claim | null
}

export interface NodeDetail extends NodeBrief {
  responsibility: Claim | null
  role: Claim | null
  constraints: Claim[]
  members: { id: string; name: string; kind: NodeKind }[]
  relations: RelationBrief[]
  /**
   * Who relies on this node, computed from the structure. Users are often two hops away (e.g. the
   * use case behind a protocol) and would otherwise be invisible to questions about this node.
   */
  usedBy: { direct: { id: string; name: string }[]; indirect: { id: string; name: string }[] }
}

export type Subject =
  | { kind: 'node'; node: NodeDetail }
  | { kind: 'nodes'; nodes: NodeDetail[]; relationsBetween: RelationBrief[] }
  | {
      kind: 'edge'
      drawn: { source: NodeBrief; target: NodeBrief }
      /** One drawn edge can stand for many graph edges at a coarse scope. */
      total: number
      byRelation: Record<string, number>
      examples: RelationBrief[]
    }
  | { kind: 'code'; node: NodeDetail; owner: NodeBrief | null; path: string; lines: { from: number; to: number }; excerpt: string }
  | { kind: 'view'; countsByKind: Record<string, number>; countsByLayer: Record<string, number>; hubs: { id: string; name: string; degree: number }[] }

export interface QuestionContext {
  question: string
  target: { kind: QuestionTarget['kind']; label: string }
  lens: {
    perspective: Perspective
    perspectiveMeaning: string
    scope: NodeBrief
    showing: string
    flow: { id: string; name: string; description: string; trigger: string; steps: string[] } | null
  }
  subject: Subject
  visible: {
    nodes: { id: string; name: string; kind: NodeKind; role: 'member' | 'context' }[]
    edges: { source: string; target: string; relation: string; edgeIds: string[]; flowSteps: number[]; concerns: string[] }[]
  }
  /** Things off-screen that are one hop from the subject, so the answer can mention them by id. */
  nearby: RelationBrief[]
  trail: string[]
  previous: { question: string; summary: string } | null
  /** How much was left out to stay within the budget. Shown to the user next to the context preview. */
  omitted: { visibleNodes: number; visibleEdges: number; nearbyRelations: number; trailSteps: number; aggregatedExamples: number }
}

const perspectiveMeaning: Record<Perspective, string> = {
  structure: '包含関係と依存関係（物理構造）を見ている',
  responsibility: '各要素の責務・役割・アーキテクチャ上の制約（論理構造）を見ている',
  flow: '処理とデータの流れ（実行時の構造）を見ている',
}

export interface BuildContextInput {
  index: GraphIndex
  exploration: ExplorationState
  target: QuestionTarget
  question: string
  previous?: { question: string; summary: string } | null
}

export function buildQuestionContext({ index, exploration, target, question, previous = null }: BuildContextInput): QuestionContext {
  const view = projectView(index, exploration)
  const omitted = { visibleNodes: 0, visibleEdges: 0, nearbyRelations: 0, trailSteps: 0, aggregatedExamples: 0 }

  const subject = buildSubject(index, target, view, omitted)
  const subjectNodeIds = subjectNodes(target)
  const visible = buildVisible(view, subjectNodeIds, omitted)
  const shownIds = new Set([...visible.nodes.map((node) => node.id), ...subjectNodeIds])
  const nearby = buildNearby(index, subjectNodeIds, shownIds, omitted)
  const trail = compressTrail(index, exploration.trail, omitted)

  return {
    question,
    target: { kind: target.kind, label: describeTarget(index, target) },
    lens: buildLens(index, exploration, view),
    subject,
    visible,
    nearby,
    trail,
    previous,
    omitted,
  }
}

function buildLens(index: GraphIndex, viewpoint: Viewpoint, view: VisibleView): QuestionContext['lens'] {
  const scope = index.node(viewpoint.scopeId)
  const childKinds = [...new Set(index.children(scope.id).map((child) => child.kind))]
  const flow = viewpoint.perspective === 'flow' && viewpoint.flowId ? index.flow(viewpoint.flowId) : null
  return {
    perspective: viewpoint.perspective,
    perspectiveMeaning: perspectiveMeaning[viewpoint.perspective],
    scope: brief(index, scope),
    showing:
      view.mode === 'code'
        ? `「${scope.name}」のコードを読んでいる`
        : `「${scope.name}」の内部（${childKinds.join(' / ')} の粒度）を表示している`,
    flow: flow && {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      trigger: flow.trigger,
      steps: flow.steps.map((step, i) => {
        const edge = index.edge(step.edgeId)
        const data = step.data ? ` [${step.data}]` : ''
        return `${i + 1}. ${index.node(edge.source).name} → ${index.node(edge.target).name} (${edge.id}): ${step.note}${data}`
      }),
    },
  }
}

function buildSubject(index: GraphIndex, target: QuestionTarget, view: VisibleView, omitted: QuestionContext['omitted']): Subject {
  switch (target.kind) {
    case 'node':
      return { kind: 'node', node: detail(index, index.node(target.nodeId)) }
    case 'nodes': {
      const ids = new Set(target.nodeIds)
      const relationsBetween = index.graph.edges
        .filter((edge) => [...ids].some((a) => index.isWithin(edge.source, a)) && [...ids].some((b) => index.isWithin(edge.target, b)))
        .map((edge) => relation(index, edge))
      return { kind: 'nodes', nodes: target.nodeIds.map((id) => detail(index, index.node(id))), relationsBetween }
    }
    case 'edge': {
      const edges = target.edgeIds.map((id) => index.edge(id))
      const examples = diverseExamples(edges, contextBudget.aggregatedExamples)
      omitted.aggregatedExamples = edges.length - examples.length
      const byRelation: Record<string, number> = {}
      for (const edge of edges) byRelation[edge.relation] = (byRelation[edge.relation] ?? 0) + 1
      return {
        kind: 'edge',
        drawn: { source: brief(index, index.node(target.source)), target: brief(index, index.node(target.target)) },
        total: edges.length,
        byRelation,
        examples: examples.map((edge) => relation(index, edge)),
      }
    }
    case 'code': {
      const node = index.node(target.nodeId)
      const code = node.code
      if (!code) throw new Error(`node ${node.id} has no code`)
      const owner = node.parentId ? index.node(node.parentId) : null
      return {
        kind: 'code',
        node: detail(index, node),
        owner: owner && brief(index, owner),
        path: code.path,
        lines: target.lines,
        excerpt: excerpt(code.text, code.startLine, target.lines),
      }
    }
    case 'view':
      return viewSubject(index, view)
  }
}

/** Picks one example per relation kind first so that an unusual relation is not hidden behind common ones. */
export function diverseExamples(edges: GraphEdge[], limit: number): GraphEdge[] {
  const picked: GraphEdge[] = []
  const seenRelations = new Set<string>()
  for (const edge of edges) {
    if (picked.length >= limit) break
    if (!seenRelations.has(edge.relation)) {
      seenRelations.add(edge.relation)
      picked.push(edge)
    }
  }
  for (const edge of edges) {
    if (picked.length >= limit) break
    if (!picked.includes(edge)) picked.push(edge)
  }
  return picked
}

/** Marks the selected lines with `>` and keeps a few surrounding lines for orientation. */
export function excerpt(text: string, startLine: number, lines: { from: number; to: number }): string {
  const all = text.split('\n')
  const first = Math.max(lines.from - contextBudget.codeContextLines, startLine)
  const last = Math.min(lines.to + contextBudget.codeContextLines, startLine + all.length - 1)
  const out: string[] = []
  for (let n = first; n <= last; n++) {
    const marker = n >= lines.from && n <= lines.to ? '>' : ' '
    out.push(`${marker} ${String(n).padStart(4)} | ${all[n - startLine] ?? ''}`)
  }
  return out.join('\n')
}

function viewSubject(index: GraphIndex, view: VisibleView): Subject {
  if (view.mode === 'code') {
    const degree = view.callers.length + view.callees.length
    return { kind: 'view', countsByKind: { [view.node.kind]: 1 }, countsByLayer: {}, hubs: [{ id: view.node.id, name: view.node.name, degree }] }
  }
  const countsByKind: Record<string, number> = {}
  const countsByLayer: Record<string, number> = {}
  const degree = new Map<string, number>()
  for (const node of view.nodes) {
    countsByKind[node.node.kind] = (countsByKind[node.node.kind] ?? 0) + 1
    if (node.layer) countsByLayer[node.layer] = (countsByLayer[node.layer] ?? 0) + 1
  }
  for (const edge of view.edges) {
    for (const end of [edge.source, edge.target]) degree.set(end, (degree.get(end) ?? 0) + edge.edgeIds.length)
  }
  const hubs = [...degree.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id, d]) => ({ id, name: index.node(id).name, degree: d }))
  return { kind: 'view', countsByKind, countsByLayer, hubs }
}

function buildVisible(view: VisibleView, subjectNodeIds: string[], omitted: QuestionContext['omitted']): QuestionContext['visible'] {
  if (view.mode === 'code') return { nodes: [], edges: [] }
  // When the view is larger than the budget, keep what touches the subject first so the
  // answer can still refer to the subject's surroundings.
  const touchesSubject = (id: string) => subjectNodeIds.includes(id)
  const edges = [...view.edges].sort((a, b) => Number(touchesSubject(b.source) || touchesSubject(b.target)) - Number(touchesSubject(a.source) || touchesSubject(a.target)))
  const keptEdges = edges.slice(0, contextBudget.visibleEdges)
  const nodes = [...view.nodes].sort((a, b) => Number(touchesSubject(b.id)) - Number(touchesSubject(a.id)))
  const keptNodes = nodes.slice(0, contextBudget.visibleNodes)
  omitted.visibleEdges = edges.length - keptEdges.length
  omitted.visibleNodes = nodes.length - keptNodes.length
  return {
    nodes: keptNodes.map((node) => ({ id: node.id, name: node.node.name, kind: node.node.kind, role: node.role })),
    edges: keptEdges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      edgeIds: edge.edgeIds,
      flowSteps: edge.flowSteps,
      concerns: edge.concerns,
    })),
  }
}

function buildNearby(index: GraphIndex, subjectNodeIds: string[], shownIds: Set<string>, omitted: QuestionContext['omitted']): RelationBrief[] {
  const relations: RelationBrief[] = []
  for (const edge of index.graph.edges) {
    const fromSubject = subjectNodeIds.some((id) => index.isWithin(edge.source, id))
    const toSubject = subjectNodeIds.some((id) => index.isWithin(edge.target, id))
    if (fromSubject === toSubject) continue
    const other = fromSubject ? edge.target : edge.source
    if (shownIds.has(other)) continue
    relations.push(relation(index, edge))
  }
  omitted.nearbyRelations = Math.max(0, relations.length - contextBudget.nearbyRelations)
  return relations.slice(0, contextBudget.nearbyRelations)
}

function subjectNodes(target: QuestionTarget): string[] {
  switch (target.kind) {
    case 'node':
    case 'code':
      return [target.nodeId]
    case 'nodes':
      return target.nodeIds
    case 'edge':
      return [target.source, target.target]
    case 'view':
      return []
  }
}

/**
 * Turns the exploration log into a few sentences. Runs of selections collapse to the last one,
 * because only where the user settled matters for the next question.
 */
export function compressTrail(index: GraphIndex, trail: readonly TrailStep[], omitted: { trailSteps: number }): string[] {
  const collapsed: TrailStep[] = []
  for (const step of trail) {
    const last = collapsed[collapsed.length - 1]
    if (last && last.action === 'select' && step.action === 'select') collapsed[collapsed.length - 1] = step
    else collapsed.push(step)
  }
  const sentences: string[] = []
  for (const step of collapsed) {
    const sentence = describeStep(index, step)
    if (sentence && sentence !== sentences[sentences.length - 1]) sentences.push(sentence)
  }
  const kept = sentences.slice(-contextBudget.trailSteps)
  omitted.trailSteps = sentences.length - kept.length
  return kept
}

function describeStep(index: GraphIndex, step: TrailStep): string | null {
  switch (step.action) {
    case 'enter':
      return `「${index.node(step.scopeId).name}」(${index.node(step.scopeId).kind}) の内部に入った`
    case 'restore':
      return `「${index.node(step.scopeId).name}」の画面に戻った`
    case 'perspective': {
      const flow = step.perspective === 'flow' && step.flowId ? `（${index.flow(step.flowId).name}）` : ''
      return `視点を ${step.perspective}${flow} に切り替えた`
    }
    case 'select':
      return step.selection.kind === 'none' ? null : `${describeTarget(index, step.selection)} を選択した`
    case 'ask':
      return `質問した: 「${step.question}」`
  }
}

export function brief(index: GraphIndex, node: GraphNode): NodeBrief {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    path: index.path(node.id).map((n) => n.name).join(' > '),
    layer: layerOf(index, node.id),
    summary: node.summary ?? null,
  }
}

function detail(index: GraphIndex, node: GraphNode): NodeDetail {
  const relations = index.graph.edges
    .filter((edge) => index.isWithin(edge.source, node.id) !== index.isWithin(edge.target, node.id))
    .slice(0, contextBudget.relationsPerNode)
    .map((edge) => relation(index, edge))
  return {
    ...brief(index, node),
    responsibility: node.responsibility ?? null,
    role: node.role ?? null,
    constraints: node.constraints ?? [],
    members: index
      .children(node.id)
      .slice(0, contextBudget.memberList)
      .map((child) => ({ id: child.id, name: child.name, kind: child.kind })),
    relations,
    usedBy: usedBy(index, node.id),
  }
}

function usedBy(index: GraphIndex, nodeId: string): NodeDetail['usedBy'] {
  const impact = simulateRemoval(index, [nodeId])
  const named = (ids: string[]) => ids.slice(0, contextBudget.usedBy).map((id) => ({ id, name: index.node(id).name }))
  return { direct: named(impact.directlyAffectedIds), indirect: named(impact.transitivelyAffectedIds) }
}

function relation(index: GraphIndex, edge: GraphEdge): RelationBrief {
  return {
    id: edge.id,
    source: { id: edge.source, name: index.node(edge.source).name },
    target: { id: edge.target, name: index.node(edge.target).name },
    relation: edge.relation,
    evidence: edge.evidence,
    rationale: edge.rationale ?? null,
  }
}
