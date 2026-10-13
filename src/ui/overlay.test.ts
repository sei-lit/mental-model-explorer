import { describe, expect, it } from 'vitest'
import { projectView } from '../core/exploration/projectView'
import { initialExploration } from '../core/exploration/state'
import { GraphIndex } from '../core/model/graphIndex'
import type { Answer } from '../core/understanding/answer'
import { bookShelfGraph } from '../data/sample/bookShelf'
import { computeOverlay, type GraphView } from './overlay'

const index = new GraphIndex(bookShelfGraph)

function viewOf(scopeId: string): GraphView {
  const view = projectView(index, { ...initialExploration(index), scopeId })
  if (view.mode !== 'graph') throw new Error('expected a graph view')
  return view
}

const emptyAnswer: Answer = { summary: '', segments: [], highlights: [], visuals: [], followUps: [] }
const noWhatIf = { shown: false, mode: 'after' as const }

describe('computeOverlay', () => {
  it('is inactive without an answer', () => {
    const overlay = computeOverlay(index, viewOf('project'), { answer: null, hoverRefs: null, whatIf: noWhatIf })
    expect(overlay.active).toBe(false)
  })

  it('maps a node deep inside a member to the member that contains it', () => {
    const answer = { ...emptyAnswer, highlights: [{ ref: 'type.BookRepositoryImpl', role: 'subject' as const }] }
    const overlay = computeOverlay(index, viewOf('project'), { answer, hoverRefs: null, whatIf: noWhatIf })
    expect(overlay.nodes.get('pkg.data')).toBe('subject')
    expect(overlay.offscreenRefs).toEqual([])
  })

  it('maps a graph edge to every drawn edge that stands for it', () => {
    const answer = { ...emptyAnswer, highlights: [{ ref: 'e.impl.dep.api', role: 'related' as const }] }
    const view = viewOf('pkg.data')
    const overlay = computeOverlay(index, view, { answer, hoverRefs: null, whatIf: noWhatIf })
    const drawn = view.edges.filter((edge) => edge.edgeIds.includes('e.impl.dep.api'))
    expect(drawn.length).toBeGreaterThan(0)
    for (const edge of drawn) expect(overlay.edges.get(edge.id)).toBe('related')
  })

  it('reports refs that nothing in the view stands for', () => {
    const answer = { ...emptyAnswer, highlights: [{ ref: 'project', role: 'subject' as const }] }
    const overlay = computeOverlay(index, viewOf('pkg.data'), { answer, hoverRefs: null, whatIf: noWhatIf })
    expect(overlay.offscreenRefs).toEqual(['project'])
  })

  it('keeps the strongest emphasis when a node is highlighted twice', () => {
    const answer = {
      ...emptyAnswer,
      highlights: [
        { ref: 'type.BookRepositoryImpl', role: 'related' as const },
        { ref: 'type.BookAPIGateway', role: 'subject' as const },
      ],
    }
    const overlay = computeOverlay(index, viewOf('project'), { answer, hoverRefs: null, whatIf: noWhatIf })
    expect(overlay.nodes.get('pkg.data')).toBe('subject')
  })

  it('numbers trace edges in order', () => {
    const answer = { ...emptyAnswer, visuals: [{ type: 'trace' as const, label: 't', edgeIds: ['e.impl.dep.api', 'e.impl.dep.cache'] }] }
    const view = viewOf('pkg.data')
    const overlay = computeOverlay(index, view, { answer, hoverRefs: null, whatIf: noWhatIf })
    const first = view.edges.find((edge) => edge.edgeIds.includes('e.impl.dep.api'))!
    const second = view.edges.find((edge) => edge.edgeIds.includes('e.impl.dep.cache'))!
    expect(overlay.traceSteps.get(first.id)).toContain(1)
    expect(overlay.traceSteps.get(second.id)).toContain(2)
  })

  it('replaces the answer emphasis with the hovered refs only', () => {
    const answer = { ...emptyAnswer, highlights: [{ ref: 'type.BookRepositoryImpl', role: 'subject' as const }] }
    const overlay = computeOverlay(index, viewOf('project'), { answer, hoverRefs: ['type.BookListView'], whatIf: noWhatIf })
    expect(overlay.nodes.get('pkg.feature')).toBe('hover')
    expect(overlay.nodes.has('pkg.data')).toBe(false)
  })

  describe('removal what-if', () => {
    const answer: Answer = { ...emptyAnswer, visuals: [{ type: 'whatIfRemove', nodeIds: ['type.BookAPIGateway'] }] }

    it('draws nothing until the what-if is shown', () => {
      const overlay = computeOverlay(index, viewOf('pkg.data'), { answer, hoverRefs: null, whatIf: noWhatIf })
      expect(overlay.active).toBe(false)
    })

    it('marks the removed node, broken edges and users in After mode', () => {
      const view = viewOf('mod.Gateway')
      const overlay = computeOverlay(index, view, { answer, hoverRefs: null, whatIf: { shown: true, mode: 'after' } })
      expect(overlay.showsWhatIf).toBe(true)
      expect(overlay.nodes.get('type.BookAPIGateway')).toBe('removed')
      const broken = view.edges.filter((edge) => edge.source === 'type.BookAPIGateway' || edge.target === 'type.BookAPIGateway')
      expect(broken.length).toBeGreaterThan(0)
      for (const edge of broken) expect(overlay.edges.get(edge.id)).toBe('broken')
    })

    it('marks a container that holds the removed node as affected', () => {
      const overlay = computeOverlay(index, viewOf('pkg.data'), { answer, hoverRefs: null, whatIf: { shown: true, mode: 'after' } })
      expect(overlay.nodes.get('mod.Gateway')).toBe('affected')
    })

    it('only outlines the target in Before mode', () => {
      const overlay = computeOverlay(index, viewOf('mod.Gateway'), { answer, hoverRefs: null, whatIf: { shown: true, mode: 'before' } })
      expect(overlay.nodes.get('type.BookAPIGateway')).toBe('removeTarget')
      expect(overlay.edges.size).toBe(0)
    })

    it('marks the repository implementation as directly affected inside the data package', () => {
      const overlay = computeOverlay(index, viewOf('pkg.data'), { answer, hoverRefs: null, whatIf: { shown: true, mode: 'after' } })
      expect(overlay.nodes.get('mod.Repository')).toBe('affectedDirect')
    })
  })
})
