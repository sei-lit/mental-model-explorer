import type { ModuleDossier } from './dossier'
import type { ModuleBriefOutput } from './moduleBrief'
import type { ResponderKind } from './responder'

/** Produces an unvalidated module brief. Callers must pass the result through validateBrief. */
export interface BriefGenerator {
  readonly kind: ResponderKind
  generate(dossier: ModuleDossier): Promise<unknown>
}

const MOCK_LIMIT = 4

/**
 * Builds a brief from the structure alone so the module page can be explored without a logged-in
 * Claude CLI. It says plainly that it is a mock; it does not pretend to know the design.
 */
export class MockBriefGenerator implements BriefGenerator {
  readonly kind = 'mock' as const

  async generate(dossier: ModuleDossier): Promise<ModuleBriefOutput> {
    const types = dossier.declarations.filter((d) => d.kind === 'type')
    const membersOf = (typeName: string) => dossier.declarations.filter((d) => d.owner === typeName)
    const largest = [...types].sort((a, b) => membersOf(b.name).length - membersOf(a.name).length).slice(0, MOCK_LIMIT)
    const uses = dossier.collaborators.filter((c) => c.direction === 'uses')
    const usedBy = dossier.collaborators.filter((c) => c.direction === 'usedBy')
    const firstUse = uses.find((c) => c.relations.length > 0)

    return {
      purpose: {
        text: `（モック）${dossier.name}${dossier.summary ? `: ${dossier.summary}` : ''}。役割の要約は claude CLI があると生成されます。`,
        evidence: largest.slice(0, 1).map((d) => d.id),
      },
      responsibilities: largest.map((type) => ({
        title: type.name,
        text: `（モック）メンバー ${membersOf(type.name).length} 個を持つ型。`,
        evidence: [membersOf(type.name)[0]?.id ?? type.id],
      })),
      publicInterface: largest.slice(0, 2).map((type) => ({ name: type.name, text: '（モック）', evidence: [type.id] })),
      state: dossier.declarations
        .filter((d) => d.kind === 'property')
        .slice(0, MOCK_LIMIT)
        .map((d) => ({ name: d.owner ? `${d.owner}.${d.name}` : d.name, text: '（モック）', evidence: [d.id] })),
      collaborators: dossier.collaborators
        .filter((c) => c.relations.length > 0)
        .map((c) => ({
          moduleId: c.moduleId,
          direction: c.direction,
          meaning: `（モック）関係 ${c.totalRelations} 件`,
          evidence: [c.relations[0]!.id],
        })),
      scenarios: firstUse
        ? [
            {
              name: `（モック）${firstUse.name} を使う`,
              trigger: '（モック）',
              steps: firstUse.relations.slice(0, 3).map((relation) => ({
                from: relation.from.id,
                to: firstUse.moduleId,
                action: `${relation.to.name} を使う`,
                evidence: [relation.id],
              })),
            },
          ]
        : [],
      boundaries: [],
      ifAbsent: usedBy
        .filter((c) => c.relations.length > 0)
        .slice(0, 2)
        .map((c) => ({ text: `（モック）${c.name} が使っている部分を自前で持つことになる。`, evidence: [c.relations[0]!.id] })),
      unknowns: ['モック応答のため、設計意図は推測していません。claude CLI があると、コードから要約を生成します。'],
    }
  }
}
