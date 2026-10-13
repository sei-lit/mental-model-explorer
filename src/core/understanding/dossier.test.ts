import { describe, expect, it } from 'vitest'
import type { ProjectGraph } from '../model/graph'
import { GraphIndex } from '../model/graphIndex'
import { miniGraph } from '../testing/miniGraph'
import { buildDossier, citableIds, dossierBudget, manifestOf, renderDossier } from './dossier'

const span = (path: string, startLine: number, endLine: number) => ({ path, startLine, endLine })
const observed = { text: 't', provenance: 'observed' as const }

const graph: ProjectGraph = {
  rootId: 'root',
  nodes: [
    { id: 'root', kind: 'project', name: 'App', parentId: null },
    { id: 'mod.Bottle', kind: 'module', name: 'Bottle', parentId: 'root' },
    { id: 'Store', kind: 'type', name: 'Store', parentId: 'mod.Bottle', spans: [span('Bottle/Store.swift', 1, 3)] },
    { id: 'Store.modify', kind: 'method', name: 'modify', parentId: 'Store', spans: [span('Bottle/Store.swift', 2, 2)] },
    { id: 'Strings', kind: 'type', name: 'Strings', parentId: 'mod.Bottle', spans: [span('Bottle/Generated/Strings.swift', 1, 9)] },
    { id: 'Gone', kind: 'type', name: 'Gone', parentId: 'mod.Bottle', spans: [span('Bottle/Gone.swift', 1, 2)] },
    { id: 'mod.Location', kind: 'module', name: 'Location', parentId: 'root', summary: '位置情報' },
    { id: 'LocationStore', kind: 'type', name: 'LocationStore', parentId: 'mod.Location' },
    { id: 'mod.Screen', kind: 'module', name: 'Screen', parentId: 'root' },
    { id: 'ScreenVM', kind: 'type', name: 'ScreenVM', parentId: 'mod.Screen' },
  ],
  edges: [
    { id: 'dep', source: 'mod.Bottle', target: 'mod.Location', relation: 'depends_on', evidence: observed },
    { id: 'ref', source: 'Store', target: 'LocationStore', relation: 'depends_on', evidence: observed },
    { id: 'use', source: 'ScreenVM', target: 'Store.modify', relation: 'calls', evidence: observed },
  ],
  flows: [],
}

const files: Record<string, string> = { 'Bottle/Store.swift': 'actor Store {\n  func modify() {}\n}', 'Bottle/Generated/Strings.swift': 'enum Strings {}' }
const read = (path: string) => files[path] ?? null

describe('buildDossier', () => {
  const dossier = buildDossier(new GraphIndex(graph), 'mod.Bottle', read)

  it('reads the files of the declarations, leaving out generated code and files it cannot read', () => {
    expect(dossier.files).toEqual([{ path: 'Bottle/Store.swift', startLine: 1, text: files['Bottle/Store.swift'] }])
    expect(dossier.excluded).toEqual([
      { path: 'Bottle/Generated/Strings.swift', reason: '生成コード' },
      { path: 'Bottle/Gone.swift', reason: '読み込めない' },
    ])
    expect(dossier.declarations.map((d) => d.id)).toEqual(['Store', 'Store.modify', 'Gone'])
    expect(dossier.declarations[1]).toMatchObject({ name: 'modify', owner: 'Store' })
  })

  it('summarises relations per collaborating module and direction, the modules it uses first', () => {
    expect(dossier.collaborators.map(({ moduleId, direction, totalRelations }) => ({ moduleId, direction, totalRelations }))).toEqual([
      { moduleId: 'mod.Location', direction: 'uses', totalRelations: 2 },
      { moduleId: 'mod.Screen', direction: 'usedBy', totalRelations: 1 },
    ])
    expect(dossier.collaborators[1]?.relations[0]).toEqual({ id: 'use', relation: 'calls', from: { id: 'ScreenVM', name: 'ScreenVM' }, to: { id: 'Store.modify', name: 'modify' } })
  })

  it('stops adding files at the size budget and says so', () => {
    const big = (path: string) => (path === 'Bottle/Store.swift' ? 'x'.repeat(dossierBudget.sourceChars + 1) : read(path))
    expect(buildDossier(new GraphIndex(graph), 'mod.Bottle', big).excluded).toContainEqual({ path: 'Bottle/Store.swift', reason: 'サイズ上限' })
  })

  it('falls back to the code excerpts on the nodes when the project has no spans', () => {
    const sample = buildDossier(new GraphIndex(miniGraph()), 'mod.Screen', () => null)
    expect(sample.files).toEqual([{ path: 'File.swift', startLine: 10, text: expect.stringContaining('func load()') }])
  })

  it('lets explanations cite the declarations, collaborating modules and their relations', () => {
    expect([...citableIds(dossier)].sort()).toEqual(['Gone', 'Store', 'Store.modify', 'dep', 'mod.Bottle', 'mod.Location', 'mod.Screen', 'ref', 'use'])
  })

  it('renders ids next to line ranges and the source with line numbers', () => {
    const text = renderDossier(dossier)
    expect(text).toContain('- Store.modify | method | Store.modify | Bottle/Store.swift:2-2')
    expect(text).toContain('   2 |   func modify() {}')
    expect(text).toContain('- Bottle/Gone.swift（読み込めない）')
  })

  it('describes what is sent without the source itself', () => {
    expect(manifestOf(dossier)).toEqual({ files: [{ path: 'Bottle/Store.swift', lines: 3 }], excluded: dossier.excluded, declarations: 3, collaborators: 2 })
  })
})
