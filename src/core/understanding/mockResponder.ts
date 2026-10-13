import type { GraphNode } from '../model/graph'
import type { GraphIndex } from '../model/graphIndex'
import type { Answer } from './answer'
import { referencedIds, type NodeDetail, type QuestionContext, type RelationBrief } from './context'
import type { Responder } from './responder'
import { simulateRemoval } from './whatIf'

type Intent = 'remove' | 'why' | 'compare' | 'code' | 'flow' | 'responsibility' | 'overview'

const intentPatterns: [Exclude<Intent, 'code' | 'overview'>, RegExp][] = [
  ['remove', /削除|消す|消し|無くな|なくな|なかったら|取り除|remove|delete|without/i],
  ['why', /なぜ|何故|理由|必要|why/i],
  ['compare', /違い|比較|どう違|differ|compare/i],
  ['flow', /流れ|フロー|順番|経路|どこを通|flow|path/i],
  ['responsibility', /責務|役割|何をする|responsib|role/i],
]

/**
 * Answers representative questions from the graph data alone so the UI can be explored without
 * a logged-in Claude CLI. It is grounded in the same context the real responder receives.
 */
export class MockResponder implements Responder {
  readonly kind = 'mock' as const

  constructor(private readonly index: GraphIndex) {}

  async ask(context: QuestionContext): Promise<Answer> {
    return onlyShown(this.compose(context), referencedIds(context))
  }

  private compose(context: QuestionContext): Answer {
    const intent = detectIntent(context)
    switch (intent) {
      case 'remove':
        return this.removal(context)
      case 'why':
        return context.subject.kind === 'edge' ? this.whyEdge(context) : this.responsibility(context)
      case 'compare':
        return context.subject.kind === 'nodes' ? this.compare(context) : this.responsibility(context)
      case 'code':
        return this.code(context)
      case 'flow':
        return this.flow(context)
      case 'responsibility':
        return this.responsibility(context)
      case 'overview':
        return this.overview(context)
    }
  }

  private removal(context: QuestionContext): Answer {
    // A name in the question usually refers to something the user can see, so on-screen matches win.
    const mentioned = mentionedNodes(this.index, context.question)
    const onScreen = new Set(context.visible.nodes.map((node) => node.id))
    const shown = referencedIds(context)
    const target = mentioned.find((id) => onScreen.has(id)) ?? mentioned.find((id) => shown.has(id)) ?? subjectNodeId(context)
    if (!target) return this.overview(context)
    const node = this.index.node(target)
    const impact = simulateRemoval(this.index, [target])
    const names = (ids: string[]) => ids.map((id) => `「${this.index.node(id).name}」`).join('、') || 'なし'
    return {
      summary: `「${node.name}」を取り除くと、${impact.directlyAffectedIds.length} 個の要素が直接参照先を失い、さらに ${impact.transitivelyAffectedIds.length} 個に影響が広がります（構造上の見積もり）。`,
      segments: [
        { text: `直接影響を受けるのは ${names(impact.directlyAffectedIds)} です。これらは「${node.name}」に依存・呼び出しをしています。`, refs: [target, ...impact.directlyAffectedIds] },
        { text: `${impact.brokenEdgeIds.length} 本の関係が切れます。`, refs: impact.brokenEdgeIds.slice(0, 8) },
        {
          text: impact.transitivelyAffectedIds.length > 0 ? `その先で ${names(impact.transitivelyAffectedIds)} も間接的に動かなくなります。` : '間接的な影響はこの範囲では見つかりませんでした。',
          refs: impact.transitivelyAffectedIds,
        },
        ...(node.responsibility ? [{ text: `「${node.name}」が担っていた責務（${node.responsibility.text}）を、別の要素が引き受ける必要があります。`, refs: [target] }] : []),
      ],
      highlights: [
        { ref: target, role: 'subject' },
        ...impact.directlyAffectedIds.map((ref) => ({ ref, role: 'affected' as const })),
        ...impact.transitivelyAffectedIds.map((ref) => ({ ref, role: 'related' as const })),
      ],
      visuals: [{ type: 'whatIfRemove', nodeIds: [target] }],
      followUps: impact.directlyAffectedIds.slice(0, 2).map((id) => ({ question: `「${this.index.node(id).name}」は何のために「${node.name}」を使っている？`, focusRef: id })),
    }
  }

  private whyEdge(context: QuestionContext): Answer {
    if (context.subject.kind !== 'edge') return this.overview(context)
    const { drawn, examples, total } = context.subject
    const primary = examples.find((example) => example.rationale) ?? examples[0]
    const segments: Answer['segments'] = [
      {
        text: total > 1 ? `この線は ${total} 本の関係をまとめたものです（${Object.entries(context.subject.byRelation).map(([r, n]) => `${r} ×${n}`).join('、')}）。` : `「${drawn.source.name}」は「${drawn.target.name}」に ${primary?.relation ?? '依存'} の関係を持っています。`,
        refs: [drawn.source.id, drawn.target.id],
      },
    ]
    if (primary) {
      segments.push({ text: `根拠: ${claimText(primary.evidence)}`, refs: [primary.id] })
      if (primary.rationale) segments.push({ text: `理由: ${claimText(primary.rationale)}`, refs: [primary.id, primary.target.id] })
    }
    const boundary = context.nearby.find((relation) => relation.relation === 'implements' && (relation.source.id === drawn.source.id || relation.target.id === drawn.target.id))
    if (boundary) segments.push({ text: `「${boundary.source.name}」は「${boundary.target.name}」を実装しており、この依存は抽象の裏側に隠れています。`, refs: [boundary.id] })
    return {
      summary: primary?.rationale ? primary.rationale.text : `「${drawn.source.name}」が「${drawn.target.name}」の機能を使うための関係です。`,
      segments,
      highlights: [
        { ref: drawn.source.id, role: 'subject' },
        { ref: drawn.target.id, role: 'subject' },
        ...examples.map((example) => ({ ref: example.id, role: 'path' as const })),
        ...(boundary ? [{ ref: boundary.id, role: 'related' as const }] : []),
      ],
      visuals: [],
      followUps: [
        { question: `「${drawn.target.name}」を削除するとどうなる？`, focusRef: drawn.target.id },
        { question: `「${drawn.target.name}」の責務は？`, focusRef: drawn.target.id },
      ],
    }
  }

  private compare(context: QuestionContext): Answer {
    if (context.subject.kind !== 'nodes') return this.overview(context)
    const { nodes, relationsBetween } = context.subject
    return {
      summary: `${nodes.map((node) => `「${node.name}」`).join('と')}は、${nodes.map((node) => node.role?.text ?? node.kind).join(' / ')} という異なる役割を持っています。`,
      segments: [
        ...nodes.map((node) => ({ text: `「${node.name}」: ${node.responsibility ? claimText(node.responsibility) : (node.summary ?? '責務の記述はありません')}`, refs: [node.id] })),
        relationsBetween.length > 0
          ? { text: `両者は ${relationsBetween.map((relation) => `${relation.source.name} → ${relation.target.name} (${relation.relation})`).join('、')} でつながっています。`, refs: relationsBetween.map((relation) => relation.id) }
          : { text: '両者の間に直接の関係はありません。', refs: [] },
      ],
      highlights: [...nodes.map((node) => ({ ref: node.id, role: 'subject' as const })), ...relationsBetween.map((relation) => ({ ref: relation.id, role: 'path' as const }))],
      visuals: [],
      followUps: nodes.map((node) => ({ question: `「${node.name}」を削除するとどうなる？`, focusRef: node.id })),
    }
  }

  private code(context: QuestionContext): Answer {
    if (context.subject.kind !== 'code') return this.overview(context)
    const { node, excerpt, lines } = context.subject
    const selected = excerpt.split('\n').filter((line) => line.startsWith('>')).join('\n')
    const guarantees = codeGuarantees(selected)
    return {
      summary: `「${node.name}」の ${lines.from}–${lines.to} 行目は、${node.summary ?? 'このメソッドの処理の一部'}を担っています。`,
      segments: [
        ...guarantees.map((text) => ({ text, refs: [node.id] })),
        ...node.relations.slice(0, 3).map((relation) => ({ text: `${relation.source.name} → ${relation.target.name} (${relation.relation}) の関係がこのコードに現れています。`, refs: [relation.id] })),
      ],
      highlights: [{ ref: node.id, role: 'subject' }, ...node.relations.slice(0, 3).map((relation) => ({ ref: relation.id, role: 'related' as const }))],
      visuals: [],
      followUps: [{ question: `「${node.name}」が失敗するとどうなる？`, focusRef: node.id }],
    }
  }

  private flow(context: QuestionContext): Answer {
    const flowId = context.lens.flow?.id
    if (!flowId) return this.overview(context)
    const flow = this.index.flow(flowId)
    const edgeIds = flow.steps.map((step) => step.edgeId)
    return {
      summary: `「${flow.name}」は ${flow.trigger} から始まり、${flow.steps.length} ステップで進みます。`,
      segments: flow.steps.map((step, i) => {
        const edge = this.index.edge(step.edgeId)
        return { text: `${i + 1}. ${this.index.node(edge.source).name} → ${this.index.node(edge.target).name}: ${step.note}`, refs: [edge.id, edge.target] }
      }),
      highlights: edgeIds.map((ref) => ({ ref, role: 'path' as const })),
      visuals: [{ type: 'trace', label: flow.name, edgeIds }],
      followUps: [{ question: 'この流れで失敗しうるのはどこ？', focusRef: null }],
    }
  }

  private responsibility(context: QuestionContext): Answer {
    const details = subjectDetails(context)
    if (details.length === 0) return this.overview(context)
    const node = details[0]!
    const dependents = node.relations.filter((relation) => this.index.isWithin(relation.target.id, node.id))
    const dependencies = node.relations.filter((relation) => !dependents.includes(relation))
    return {
      summary: node.responsibility ? node.responsibility.text : `「${node.name}」は ${node.summary ?? node.kind} です。`,
      segments: [
        ...(node.role ? [{ text: `役割: ${claimText(node.role)}`, refs: [node.id] }] : []),
        ...node.constraints.map((constraint) => ({ text: `制約: ${claimText(constraint)}`, refs: [node.id] })),
        ...(dependencies.length > 0 ? [{ text: `使っているもの: ${uniqueNames(dependencies.map((r) => r.target.name))}`, refs: dependencies.map((r) => r.id) }] : []),
        ...(dependents.length > 0 ? [{ text: `使われているところ: ${uniqueNames(dependents.map((r) => r.source.name))}`, refs: dependents.map((r) => r.id) }] : []),
      ],
      highlights: [{ ref: node.id, role: 'subject' }, ...node.relations.map((relation) => ({ ref: relation.id, role: 'related' as const }))],
      visuals: [],
      followUps: [
        { question: `「${node.name}」を削除するとどうなる？`, focusRef: node.id },
        ...dependencies.slice(0, 1).map((relation) => ({ question: 'なぜこの依存関係が必要なの？', focusRef: relation.id })),
      ],
    }
  }

  private overview(context: QuestionContext): Answer {
    const subject = context.subject
    const hubs = subject.kind === 'view' ? subject.hubs : []
    const violations = context.visible.edges.filter((edge) => edge.concerns.includes('layerViolation'))
    return {
      summary: `${context.lens.showing}。${context.visible.nodes.length} 個の要素と ${context.visible.edges.length} 本の関係が見えています。`,
      segments: [
        ...(hubs.length > 0 ? [{ text: `関係が集中しているのは ${hubs.map((hub) => `「${hub.name}」(${hub.degree})`).join('、')} です。`, refs: hubs.map((hub) => hub.id) }] : []),
        ...(subject.kind === 'view' && Object.keys(subject.countsByLayer).length > 0
          ? [{ text: `層の内訳: ${Object.entries(subject.countsByLayer).map(([layer, n]) => `${layer} ${n}`).join('、')}。`, refs: [] }]
          : []),
        ...(violations.length > 0
          ? [{ text: `層の向きに反する依存が ${violations.length} 本あります。設計上の議論の起点になります。`, refs: violations.flatMap((edge) => edge.edgeIds) }]
          : [{ text: 'この範囲に層の向きに反する依存はありません。', refs: [] }]),
      ],
      highlights: [...hubs.map((hub) => ({ ref: hub.id, role: 'subject' as const })), ...violations.flatMap((edge) => edge.edgeIds.map((ref) => ({ ref, role: 'affected' as const })))],
      visuals: [],
      followUps: hubs.slice(0, 2).map((hub) => ({ question: `「${hub.name}」の責務は？`, focusRef: hub.id })),
    }
  }
}

/**
 * The mock computes impacts over the whole graph, but a well-behaved model can only cite what the
 * context showed it; dropping the rest keeps the mock's answers passing the same validation.
 */
function onlyShown(answer: Answer, shown: ReadonlySet<string>): Answer {
  return {
    ...answer,
    segments: answer.segments.map((segment) => ({ ...segment, refs: segment.refs.filter((ref) => shown.has(ref)) })),
    highlights: answer.highlights.filter((highlight) => shown.has(highlight.ref)),
    visuals: answer.visuals.filter((visual) => (visual.type === 'whatIfRemove' ? visual.nodeIds : visual.edgeIds).every((id) => shown.has(id))),
    followUps: answer.followUps.map((followUp) => (followUp.focusRef && !shown.has(followUp.focusRef) ? { ...followUp, focusRef: null } : followUp)),
  }
}

export function detectIntent(context: QuestionContext): Intent {
  for (const [intent, pattern] of intentPatterns) if (pattern.test(context.question)) return intent
  if (context.subject.kind === 'code') return 'code'
  if (context.subject.kind === 'view') return context.lens.perspective === 'flow' ? 'flow' : 'overview'
  if (context.subject.kind === 'nodes') return 'compare'
  if (context.subject.kind === 'edge') return 'why'
  return 'responsibility'
}

/** Finds nodes whose name or alias appears in the question: longest match first, an exact name before an alias. */
export function mentionedNodes(index: GraphIndex, question: string): string[] {
  const lower = question.toLowerCase()
  const candidates: { node: GraphNode; length: number; byName: boolean }[] = []
  for (const node of index.graph.nodes) {
    if (node.kind === 'method' || node.kind === 'property') continue
    const hit = [node.name, ...(node.aliases ?? [])].filter((name) => lower.includes(name.toLowerCase())).sort((a, b) => b.length - a.length)[0]
    if (hit) candidates.push({ node, length: hit.length, byName: hit === node.name })
  }
  return candidates.sort((a, b) => b.length - a.length || Number(b.byName) - Number(a.byName)).map((candidate) => candidate.node.id)
}

function subjectNodeId(context: QuestionContext): string | null {
  const subject = context.subject
  switch (subject.kind) {
    case 'node':
    case 'code':
      return subject.node.id
    case 'nodes':
      return subject.nodes[0]?.id ?? null
    case 'edge':
      return subject.drawn.target.id
    case 'view':
      return null
  }
}

function subjectDetails(context: QuestionContext): NodeDetail[] {
  const subject = context.subject
  if (subject.kind === 'node' || subject.kind === 'code') return [subject.node]
  if (subject.kind === 'nodes') return subject.nodes
  return []
}

function claimText(claim: RelationBrief['evidence']): string {
  const label = claim.provenance === 'observed' ? 'コードで確認' : '推測'
  return `${claim.text}（${label}${claim.source ? `: ${claim.source}` : ''}）`
}

function uniqueNames(names: string[]): string {
  return [...new Set(names)].map((name) => `「${name}」`).join('、')
}

function codeGuarantees(code: string): string[] {
  const found: string[] = []
  if (/\bguard\b/.test(code)) found.push('guard で前提条件を満たさない場合を早期に抜け、以降の処理が前提を満たした状態で動くことを保証しています。')
  if (/\bthrow|\btry\b/.test(code)) found.push('失敗をエラーとして呼び出し側へ伝え、握りつぶさないことを保証しています。')
  if (/\bcatch\b/.test(code)) found.push('catch で失敗を受け止め、代替の結果に切り替えています。')
  if (/\bawait\b/.test(code)) found.push('await で非同期処理の完了を待ち、結果が揃ってから次へ進むことを保証しています。')
  if (/@MainActor|MainActor/.test(code)) found.push('MainActor 上で状態を更新し、UI スレッドからだけ変更されることを保証しています。')
  if (found.length === 0) found.push('選択範囲は値の受け渡しと変換を行っており、特別な保証は書かれていません。')
  return found
}
