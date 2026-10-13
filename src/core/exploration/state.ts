import type { GraphIndex } from '../model/graphIndex'

export type Perspective = 'structure' | 'responsibility' | 'flow'

export interface LineRange {
  from: number
  to: number
}

/**
 * What the user is pointing at. An edge selection keeps the displayed endpoints together with the
 * underlying graph edges, because at a coarse scope one drawn edge stands for many real ones.
 */
export type Selection =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'nodes'; nodeIds: string[] }
  | { kind: 'edge'; source: string; target: string; edgeIds: string[] }
  | { kind: 'code'; nodeId: string; lines: LineRange }

export interface Viewpoint {
  scopeId: string
  perspective: Perspective
  flowId: string | null
  selection: Selection
}

export type TrailStep =
  | { action: 'enter'; scopeId: string }
  | { action: 'select'; selection: Selection }
  | { action: 'perspective'; perspective: Perspective; flowId: string | null }
  | { action: 'ask'; question: string; selection: Selection }
  | { action: 'restore'; scopeId: string }

export interface ExplorationState extends Viewpoint {
  /** Navigation history for back/forward. Each entry is a full viewpoint. */
  history: Viewpoint[]
  historyIndex: number
  /** Chronological log of what the user did; context building extracts a compressed tail from it. */
  trail: TrailStep[]
}

export type ExplorationAction =
  | { type: 'enterScope'; scopeId: string }
  | { type: 'select'; selection: Selection }
  | { type: 'toggleNodeInSelection'; nodeId: string }
  | { type: 'setPerspective'; perspective: Perspective }
  | { type: 'setFlow'; flowId: string }
  | { type: 'recordQuestion'; question: string }
  | { type: 'restore'; viewpoint: Viewpoint }
  | { type: 'back' }
  | { type: 'forward' }

export const TRAIL_LIMIT = 50
export const HISTORY_LIMIT = 50

export const noSelection: Selection = { kind: 'none' }

export function initialExploration(index: GraphIndex): ExplorationState {
  const viewpoint: Viewpoint = {
    scopeId: index.root.id,
    perspective: 'structure',
    flowId: index.graph.flows[0]?.id ?? null,
    selection: noSelection,
  }
  return { ...viewpoint, history: [viewpoint], historyIndex: 0, trail: [{ action: 'enter', scopeId: viewpoint.scopeId }] }
}

export function viewpointOf(state: ExplorationState): Viewpoint {
  return { scopeId: state.scopeId, perspective: state.perspective, flowId: state.flowId, selection: state.selection }
}

/** A node can become the scope when it has children to lay out, or when it carries code to read. */
export function canEnter(index: GraphIndex, nodeId: string): boolean {
  const node = index.node(nodeId)
  return index.children(nodeId).length > 0 || node.code !== undefined
}

export function createExplorationReducer(index: GraphIndex) {
  return function reduce(state: ExplorationState, action: ExplorationAction): ExplorationState {
    switch (action.type) {
      case 'enterScope': {
        if (action.scopeId === state.scopeId || !canEnter(index, action.scopeId)) return state
        // Entering a node from the outside is the usual way to drill in, so the entered node stays
        // selected; questions asked right after entering are about that node.
        const selection: Selection = { kind: 'node', nodeId: action.scopeId }
        return navigate(state, { ...viewpointOf(state), scopeId: action.scopeId, selection }, { action: 'enter', scopeId: action.scopeId })
      }
      case 'select': {
        if (sameSelection(state.selection, action.selection)) return state
        return withTrail({ ...state, selection: action.selection }, { action: 'select', selection: action.selection })
      }
      case 'toggleNodeInSelection': {
        const selection = toggleNode(state.selection, action.nodeId)
        return withTrail({ ...state, selection }, { action: 'select', selection })
      }
      case 'setPerspective': {
        if (action.perspective === state.perspective) return state
        // Selection and scope are kept on purpose: switching perspective re-describes the same target.
        return navigate(state, { ...viewpointOf(state), perspective: action.perspective }, {
          action: 'perspective',
          perspective: action.perspective,
          flowId: state.flowId,
        })
      }
      case 'setFlow': {
        if (action.flowId === state.flowId) return state
        index.flow(action.flowId)
        return navigate(state, { ...viewpointOf(state), perspective: 'flow', flowId: action.flowId }, {
          action: 'perspective',
          perspective: 'flow',
          flowId: action.flowId,
        })
      }
      case 'recordQuestion':
        return withTrail(state, { action: 'ask', question: action.question, selection: state.selection })
      case 'restore':
        return navigate(state, action.viewpoint, { action: 'restore', scopeId: action.viewpoint.scopeId })
      case 'back':
        return moveInHistory(state, state.historyIndex - 1)
      case 'forward':
        return moveInHistory(state, state.historyIndex + 1)
    }
  }
}

function navigate(state: ExplorationState, next: Viewpoint, step: TrailStep): ExplorationState {
  const kept = state.history.slice(0, state.historyIndex + 1)
  const history = [...kept, next].slice(-HISTORY_LIMIT)
  return withTrail({ ...state, ...next, history, historyIndex: history.length - 1 }, step)
}

function moveInHistory(state: ExplorationState, targetIndex: number): ExplorationState {
  const target = state.history[targetIndex]
  if (!target) return state
  return withTrail({ ...state, ...target, historyIndex: targetIndex }, { action: 'restore', scopeId: target.scopeId })
}

function withTrail(state: ExplorationState, step: TrailStep): ExplorationState {
  return { ...state, trail: [...state.trail, step].slice(-TRAIL_LIMIT) }
}

function toggleNode(selection: Selection, nodeId: string): Selection {
  const current = selectedNodeIds(selection)
  const next = current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]
  if (next.length === 0) return noSelection
  if (next.length === 1) return { kind: 'node', nodeId: next[0]! }
  return { kind: 'nodes', nodeIds: next }
}

export function selectedNodeIds(selection: Selection): string[] {
  switch (selection.kind) {
    case 'node':
    case 'code':
      return [selection.nodeId]
    case 'nodes':
      return selection.nodeIds
    case 'edge':
    case 'none':
      return []
  }
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
