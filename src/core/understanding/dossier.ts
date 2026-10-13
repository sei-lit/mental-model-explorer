import type { GraphEdge, GraphNode, NodeKind, SourceSpan } from '../model/graph'
import type { GraphIndex } from '../model/graphIndex'
import { diverseExamples } from './context'

export interface DossierDeclaration {
  id: string
  kind: NodeKind
  name: string
  /** The type a member belongs to, so "load" can be told apart from another type's "load". */
  owner: string | null
  spans: SourceSpan[]
}

export interface DossierFile {
  path: string
  /** Line number of the first line of `text`; 1 unless only an excerpt is available. */
  startLine: number
  text: string
}

export interface DossierRelation {
  id: string
  relation: GraphEdge['relation']
  from: { id: string; name: string }
  to: { id: string; name: string }
}

export interface DossierCollaborator {
  moduleId: string
  name: string
  summary: string | null
  direction: 'uses' | 'usedBy'
  relations: DossierRelation[]
  totalRelations: number
}

/**
 * Everything the AI reads to explain one module. It is built on the server, which can read the
 * files; the browser only ever sees its manifest and the files for display.
 */
export interface ModuleDossier {
  moduleId: string
  name: string
  path: string
  summary: string | null
  declarations: DossierDeclaration[]
  files: DossierFile[]
  excluded: { path: string; reason: string }[]
  collaborators: DossierCollaborator[]
}

export const dossierBudget = {
  /** About a third of Sonnet's context window, leaving room for the instructions and the answer. */
  sourceChars: 240_000,
  relationsPerCollaborator: 12,
} as const

export type ReadSource = (path: string) => string | null

/**
 * Generated code is excluded because it explains nothing about the design and crowds out the code
 * that does. Mocks and tests are kept: they are sometimes the only example of how a module is used.
 */
const isGenerated = (path: string) => path.split('/').includes('Generated')

export function buildDossier(index: GraphIndex, moduleId: string, readSource: ReadSource): ModuleDossier {
  const module = index.node(moduleId)
  const declarations = descendants(index, moduleId)
    .filter((node) => node.kind === 'type' || node.kind === 'method' || node.kind === 'property')
    .map((node) => ({ id: node.id, kind: node.kind, name: node.name, owner: ownerName(index, node), spans: node.spans ?? [] }))
  const { files, excluded } = collectFiles(index, moduleId, declarations, readSource)
  return {
    moduleId,
    name: module.name,
    path: index.path(moduleId).map((node) => node.name).join(' > '),
    summary: module.summary ?? null,
    declarations: declarations.filter((declaration) => !declaration.spans.some((span) => isGenerated(span.path))),
    files,
    excluded,
    collaborators: collaborators(index, moduleId),
  }
}

function descendants(index: GraphIndex, id: string): GraphNode[] {
  const found: GraphNode[] = []
  const visit = (parentId: string) => {
    for (const child of index.children(parentId)) {
      found.push(child)
      visit(child.id)
    }
  }
  visit(id)
  return found
}

function ownerName(index: GraphIndex, node: GraphNode): string | null {
  if (node.kind === 'type' || !node.parentId) return null
  const parent = index.node(node.parentId)
  return parent.kind === 'type' ? parent.name : null
}

function collectFiles(index: GraphIndex, moduleId: string, declarations: DossierDeclaration[], readSource: ReadSource) {
  const paths = [...new Set(declarations.flatMap((declaration) => declaration.spans.map((span) => span.path)))].sort()
  const files: DossierFile[] = []
  const excluded: { path: string; reason: string }[] = []
  let used = 0
  for (const path of paths) {
    if (isGenerated(path)) {
      excluded.push({ path, reason: '生成コード' })
      continue
    }
    const text = readSource(path)
    if (text === null) {
      excluded.push({ path, reason: '読み込めない' })
      continue
    }
    if (used + text.length > dossierBudget.sourceChars) {
      excluded.push({ path, reason: 'サイズ上限' })
      continue
    }
    used += text.length
    files.push({ path, startLine: 1, text })
  }
  if (paths.length > 0) return { files, excluded }
  // Projects without spans (the bundled sample) only have the code excerpts kept on the nodes.
  for (const node of descendants(index, moduleId)) {
    if (node.code) files.push({ path: node.code.path, startLine: node.code.startLine, text: node.code.text })
  }
  return { files, excluded }
}

/** The modules this one uses and is used by, each with the concrete relations that show it. */
function collaborators(index: GraphIndex, moduleId: string): DossierCollaborator[] {
  const byKey = new Map<string, { moduleId: string; direction: 'uses' | 'usedBy'; edges: GraphEdge[] }>()
  const visit = (id: string) => {
    for (const edge of index.edgesTouching(id)) {
      const outgoing = index.isWithin(edge.source, moduleId)
      const other = outgoing ? edge.target : edge.source
      if (index.isWithin(other, moduleId)) continue
      const otherModule = enclosingModule(index, other)
      const direction = outgoing ? 'uses' : 'usedBy'
      const key = `${direction}:${otherModule}`
      const entry = byKey.get(key) ?? { moduleId: otherModule, direction, edges: [] }
      if (!entry.edges.includes(edge)) entry.edges.push(edge)
      byKey.set(key, entry)
    }
    for (const child of index.children(id)) visit(child.id)
  }
  visit(moduleId)
  return [...byKey.values()]
    .sort((a, b) => Number(a.direction === 'usedBy') - Number(b.direction === 'usedBy') || b.edges.length - a.edges.length)
    .map(({ moduleId: otherId, direction, edges }) => {
      const other = index.node(otherId)
      return {
        moduleId: otherId,
        name: other.name,
        summary: other.summary ?? null,
        direction,
        relations: diverseExamples(edges, dossierBudget.relationsPerCollaborator).map((edge) => ({
          id: edge.id,
          relation: edge.relation,
          from: { id: edge.source, name: index.node(edge.source).name },
          to: { id: edge.target, name: index.node(edge.target).name },
        })),
        totalRelations: edges.length,
      }
    })
}

/** Relations are summarised per module; an end outside any module (e.g. a package) stands for itself. */
function enclosingModule(index: GraphIndex, id: string): string {
  return index.path(id).find((node) => node.kind === 'module')?.id ?? id
}

/** Ids an explanation of the module may cite: its declarations, the collaborating modules and their relations. */
export function citableIds(dossier: ModuleDossier): Set<string> {
  const ids = new Set<string>([dossier.moduleId])
  for (const declaration of dossier.declarations) ids.add(declaration.id)
  for (const collaborator of dossier.collaborators) {
    ids.add(collaborator.moduleId)
    for (const relation of collaborator.relations) ids.add(relation.id)
  }
  return ids
}

/** The dossier as the AI reads it: ids next to line ranges, and the files with line numbers. */
export function renderDossier(dossier: ModuleDossier): string {
  const lines: string[] = [`# モジュール ${dossier.name} (id: ${dossier.moduleId})`, `場所: ${dossier.path}`]
  if (dossier.summary) lines.push(`解析時のメモ: ${dossier.summary}`)

  lines.push('', '## 宣言（根拠に使える ID と、その行範囲）')
  for (const declaration of dossier.declarations) {
    const name = declaration.owner ? `${declaration.owner}.${declaration.name}` : declaration.name
    const where = declaration.spans.map((span) => `${span.path}:${span.startLine}-${span.endLine}`).join(', ')
    lines.push(`- ${declaration.id} | ${declaration.kind} | ${name}${where ? ` | ${where}` : ''}`)
  }

  lines.push('', '## 協働するモジュール（関係はコードから観測したもの）')
  for (const collaborator of dossier.collaborators) {
    const direction = collaborator.direction === 'uses' ? 'このモジュールが使う' : 'このモジュールを使う'
    lines.push(`### ${direction}: ${collaborator.name} (id: ${collaborator.moduleId})${collaborator.summary ? ` — ${collaborator.summary}` : ''}`)
    for (const relation of collaborator.relations) lines.push(`- ${relation.id}: ${relation.from.name} → ${relation.to.name} (${relation.relation})`)
    const rest = collaborator.totalRelations - collaborator.relations.length
    if (rest > 0) lines.push(`- ほか ${rest} 件`)
  }

  lines.push('', '## ソース')
  for (const file of dossier.files) {
    lines.push(`### ${file.path}`, '```')
    file.text.split('\n').forEach((text, i) => lines.push(`${String(file.startLine + i).padStart(4)} | ${text}`))
    lines.push('```')
  }
  if (dossier.excluded.length > 0) {
    lines.push('', '## 含めなかったファイル')
    for (const file of dossier.excluded) lines.push(`- ${file.path}（${file.reason}）`)
  }
  return lines.join('\n')
}

/** What the user can check about the dossier without downloading it. */
export interface DossierManifest {
  files: { path: string; lines: number }[]
  excluded: { path: string; reason: string }[]
  declarations: number
  collaborators: number
}

export function manifestOf(dossier: ModuleDossier): DossierManifest {
  return {
    files: dossier.files.map((file) => ({ path: file.path, lines: file.text.split('\n').length })),
    excluded: dossier.excluded,
    declarations: dossier.declarations.length,
    collaborators: dossier.collaborators.length,
  }
}
