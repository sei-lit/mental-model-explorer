import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../model/graphIndex'
import { miniGraph } from '../testing/miniGraph'
import { MockBriefGenerator } from './briefGenerator'
import type { ModuleDossier } from './dossier'
import { buildDossier } from './dossier'
import { BriefFormatError, validateBrief, type ModuleBriefOutput } from './moduleBrief'

const dossier: ModuleDossier = {
  moduleId: 'mod.Bottle',
  name: 'Bottle',
  path: 'App > Bottle',
  summary: null,
  declarations: [
    { id: 'Store', kind: 'type', name: 'Store', owner: null, spans: [] },
    { id: 'Store.modify', kind: 'method', name: 'modify', owner: 'Store', spans: [] },
  ],
  files: [],
  excluded: [],
  collaborators: [{ moduleId: 'mod.Location', name: 'Location', summary: null, direction: 'uses', relations: [{ id: 'ref', relation: 'depends_on', from: { id: 'Store', name: 'Store' }, to: { id: 'L', name: 'L' } }], totalRelations: 1 }],
}

const output = (overrides: Partial<ModuleBriefOutput> = {}): ModuleBriefOutput => ({
  purpose: { text: 'ボトルの状態を管理する', evidence: ['Store'] },
  responsibilities: [
    { title: '状態の保持', text: 't', evidence: ['Store.modify'] },
    { title: '配信', text: 't', evidence: ['Store'] },
  ],
  publicInterface: [],
  state: [],
  collaborators: [],
  scenarios: [],
  boundaries: [],
  ifAbsent: [],
  unknowns: [],
  ...overrides,
})

describe('validateBrief', () => {
  it('keeps statements whose evidence exists, removing the ids that do not', () => {
    const { brief, dropped, partial } = validateBrief(output({ boundaries: [{ text: '位置は Location に任せる', evidence: ['ref', 'Ghost'] }] }), dossier)

    expect(brief.boundaries).toEqual([{ text: '位置は Location に任せる', evidence: ['ref'] }])
    expect(dropped).toEqual([])
    expect(partial).toBe(false)
  })

  it('drops a statement left without evidence and reports it instead of showing it as grounded', () => {
    const { brief, dropped } = validateBrief(output({ ifAbsent: [{ text: '画面が壊れる', evidence: ['Ghost'] }, { text: '根拠なし', evidence: [] }] }), dossier)

    expect(brief.ifAbsent).toEqual([])
    expect(dropped).toEqual([
      { section: 'ifAbsent', text: '画面が壊れる' },
      { section: 'ifAbsent', text: '根拠なし' },
    ])
  })

  it('marks the brief partial when the purpose or most responsibilities cannot be grounded', () => {
    expect(validateBrief(output({ purpose: { text: 'p', evidence: ['Ghost'] } }), dossier)).toMatchObject({ brief: { purpose: null }, partial: true })
    expect(validateBrief(output({ responsibilities: [{ title: 'a', text: 't', evidence: ['Store'] }] }), dossier).partial).toBe(true)
  })

  it('only accepts collaborators the code shows, in the direction it shows them', () => {
    const { brief, dropped } = validateBrief(
      output({
        collaborators: [
          { moduleId: 'mod.Location', direction: 'uses', meaning: '位置を受け取る', evidence: ['ref'] },
          { moduleId: 'mod.Location', direction: 'usedBy', meaning: '逆向き', evidence: ['ref'] },
          { moduleId: 'mod.Other', direction: 'uses', meaning: '無関係', evidence: ['ref'] },
        ],
      }),
      dossier,
    )

    expect(brief.collaborators.map((c) => c.meaning)).toEqual(['位置を受け取る'])
    expect(dropped.map((d) => d.text)).toEqual(['逆向き', '無関係'])
  })

  it('drops scenario steps between unknown participants, and scenarios left empty', () => {
    const { brief } = validateBrief(
      output({
        scenarios: [
          {
            name: '更新',
            trigger: 't',
            steps: [
              { from: 'Store.modify', to: 'mod.Location', action: '位置を読む', evidence: ['ref'] },
              { from: 'Store', to: 'Ghost', action: '架空', evidence: ['Store'] },
            ],
          },
          { name: '架空の流れ', trigger: 't', steps: [{ from: 'Ghost', to: 'Store', action: 'a', evidence: ['Store'] }] },
        ],
      }),
      dossier,
    )

    expect(brief.scenarios).toEqual([{ name: '更新', trigger: 't', steps: [{ from: 'Store.modify', to: 'mod.Location', action: '位置を読む', evidence: ['ref'] }] }])
  })

  it('rejects output that does not match the schema', () => {
    expect(() => validateBrief({ purpose: 'x' }, dossier)).toThrow(BriefFormatError)
  })
})

describe('MockBriefGenerator', () => {
  it('produces a brief the validator accepts, so the page works without the claude CLI', async () => {
    const sample = buildDossier(new GraphIndex(miniGraph()), 'mod.Screen', () => null)
    const { brief, dropped } = validateBrief(await new MockBriefGenerator().generate(sample), sample)

    expect(dropped).toEqual([])
    expect(brief.purpose?.text).toContain('（モック）')
    expect(brief.collaborators.length).toBeGreaterThan(0)
  })
})
