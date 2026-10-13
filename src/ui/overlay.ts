import type { VisibleView } from '../core/exploration/projectView'
import type { GraphIndex } from '../core/model/graphIndex'
import type { Answer, HighlightRole } from '../core/understanding/answer'
import { simulateRemoval } from '../core/understanding/whatIf'

export type GraphView = Extract<VisibleView, { mode: 'graph' }>

export type WhatIfMode = 'after' | 'before'

/** How strongly and in which way a view element is emphasized. Ordered by precedence below. */
export type Emphasis =
  | 'hover'
  | 'removed'
  | 'removeTarget'
  | 'broken'
  | 'subject'
  | 'affected'
  | 'affectedDirect'
  | 'affectedTransitive'
  | 'related'
  | 'path'

const precedence: Emphasis[] = [
  'hover',
  'removed',
  'removeTarget',
  'broken',
  'subject',
  'affectedDirect',
  'affected',
  'affectedTransitive',
  'related',
  'path',
]

export interface ViewOverlay {
  /** True while some answer element is being drawn; non-emphasized elements are dimmed. */
  active: boolean
  nodes: Map<string, Emphasis>
  edges: Map<string, Emphasis>
  /** Trace step numbers per drawn edge. */
  traceSteps: Map<string, number[]>
  /** Referenced graph ids that no element of the current view stands for. */
  offscreenRefs: string[]
  /** Set when the removal estimate is drawn, so the UI can label it. */
  showsWhatIf: boolean
}

export interface OverlayInput {
  answer: Answer | null
  /** Refs of a hovered answer segment; they replace the answer's own emphasis while hovering. */
  hoverRefs: readonly string[] | null
  whatIf: { shown: boolean; mode: WhatIfMode }
}

export const emptyOverlay: ViewOverlay = {
  active: false,
  nodes: new Map(),
  edges: new Map(),
  traceSteps: new Map(),
  offscreenRefs: [],
  showsWhatIf: false,
}

const roleEmphasis: Record<HighlightRole, Emphasis> = {
  subject: 'subject',
  affected: 'affected',
  related: 'related',
  path: 'path',
}

export function computeOverlay(index: GraphIndex, view: Pick<GraphView, 'nodes' | 'edges'>, input: OverlayInput): ViewOverlay {
  const overlay: ViewOverlay = { ...emptyOverlay, nodes: new Map(), edges: new Map(), traceSteps: new Map(), offscreenRefs: [] }
  const offscreen = new Set<string>()

  const viewNodeIdsFor = (nodeId: string) => view.nodes.filter((viewNode) => index.isWithin(nodeId, viewNode.id)).map((viewNode) => viewNode.id)
  const viewEdgeIdsFor = (edgeId: string) => view.edges.filter((viewEdge) => viewEdge.edgeIds.includes(edgeId)).map((viewEdge) => viewEdge.id)

  const mark = (ref: string, emphasis: Emphasis) => {
    const targets = index.hasNode(ref)
      ? { ids: viewNodeIdsFor(ref), into: overlay.nodes }
      : { ids: viewEdgeIdsFor(ref), into: overlay.edges }
    if (targets.ids.length === 0) offscreen.add(ref)
    for (const id of targets.ids) strengthen(targets.into, id, emphasis)
  }

  if (input.hoverRefs && input.hoverRefs.length > 0) {
    for (const ref of input.hoverRefs) mark(ref, 'hover')
  } else if (input.answer) {
    const { answer } = input
    for (const highlight of answer.highlights) mark(highlight.ref, roleEmphasis[highlight.role])

    for (const visual of answer.visuals) {
      if (visual.type === 'trace') {
        visual.edgeIds.forEach((edgeId, i) => {
          mark(edgeId, 'path')
          for (const viewEdgeId of viewEdgeIdsFor(edgeId)) {
            const steps = overlay.traceSteps.get(viewEdgeId) ?? []
            if (!steps.includes(i + 1)) overlay.traceSteps.set(viewEdgeId, [...steps, i + 1])
          }
        })
      } else if (input.whatIf.shown) {
        overlay.showsWhatIf = true
        markRemoval(index, view, visual.nodeIds, input.whatIf.mode, overlay, mark)
      }
    }
  }

  overlay.offscreenRefs = [...offscreen]
  overlay.active = overlay.nodes.size > 0 || overlay.edges.size > 0
  return overlay
}

function markRemoval(
  index: GraphIndex,
  view: Pick<GraphView, 'nodes' | 'edges'>,
  nodeIds: readonly string[],
  mode: WhatIfMode,
  overlay: ViewOverlay,
  mark: (ref: string, emphasis: Emphasis) => void,
) {
  if (mode === 'before') {
    for (const id of nodeIds) mark(id, 'removeTarget')
    return
  }
  const impact = simulateRemoval(index, nodeIds)
  // A drawn node that is itself inside a removed node disappears; one that only contains a removed node is partly affected.
  for (const viewNode of view.nodes) {
    if (nodeIds.some((id) => index.isWithin(viewNode.id, id))) strengthen(overlay.nodes, viewNode.id, 'removed')
  }
  for (const id of nodeIds) mark(id, 'affected')
  for (const id of impact.directlyAffectedIds) mark(id, 'affectedDirect')
  for (const id of impact.transitivelyAffectedIds) mark(id, 'affectedTransitive')
  for (const id of impact.brokenEdgeIds) {
    for (const viewEdge of view.edges) if (viewEdge.edgeIds.includes(id)) strengthen(overlay.edges, viewEdge.id, 'broken')
  }
}

function strengthen(target: Map<string, Emphasis>, id: string, emphasis: Emphasis) {
  const current = target.get(id)
  if (current === undefined || precedence.indexOf(emphasis) < precedence.indexOf(current)) target.set(id, emphasis)
}
