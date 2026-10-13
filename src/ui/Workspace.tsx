import type { Viewport } from '@xyflow/react'
import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { projectView, type ViewEdge } from '../core/exploration/projectView'
import {
  canEnter,
  createExplorationReducer,
  initialExploration,
  noSelection,
  sameSelection,
  selectedNodeIds,
  viewpointOf,
  type LineRange,
  type Selection,
} from '../core/exploration/state'
import type { GraphEdge, ProjectGraph } from '../core/model/graph'
import { GraphIndex } from '../core/model/graphIndex'
import { buildQuestionContext } from '../core/understanding/context'
import { describeTarget, targetFromSelection, type QuestionTarget } from '../core/understanding/target'
import { AskBar } from './AskBar'
import { CodeView } from './CodeView'
import { ExplanationPanel } from './ExplanationPanel'
import { Inspector } from './Inspector'
import { Legend } from './Legend'
import { TopBar } from './TopBar'
import { ask, type ClientConfig } from './api/client'
import { CanvasErrorBoundary } from './canvas/CanvasErrorBoundary'
import { GraphCanvas } from './canvas/GraphCanvas'
import { layoutKey } from './canvas/layout'
import { ModulePage } from './module/ModulePage'
import { useModuleBrief } from './module/useModuleBrief'
import { computeOverlay, emptyOverlay, type GraphView } from './overlay'
import { initialUnderstanding, previousTurn, resultOf, understandingReducer, type AnswerCard } from './understandingState'

const noGraph = { nodes: [], edges: [] } satisfies Pick<GraphView, 'nodes' | 'edges'>

export function Workspace({ graph, config }: { graph: ProjectGraph; config: ClientConfig }) {
  const index = useMemo(() => new GraphIndex(graph), [graph])
  const reducer = useMemo(() => createExplorationReducer(index), [index])
  const [exploration, dispatch] = useReducer(reducer, index, initialExploration)
  const [understanding, understand] = useReducer(understandingReducer, initialUnderstanding)

  const [question, setQuestion] = useState('')
  const [wholeViewFor, setWholeViewFor] = useState<Selection | null>(null)
  const [previewingContext, setPreviewingContext] = useState(false)
  const [modulePageId, setModulePageId] = useState<string | null>(null)
  const [codeRef, setCodeRef] = useState<string | null>(null)
  const { state: briefState, retry: retryBrief } = useModuleBrief(modulePageId)
  const moduleBrief = briefState?.status === 'ready' ? briefState.result : null
  const viewports = useRef(new Map<string, Viewport>())
  const cardSequence = useRef(0)

  const { scopeId, perspective, flowId, aroundChanges, selection } = exploration
  // The selection only changes the projection while narrowed to changes (it keeps the selected node
  // drawn); otherwise selecting must not recompute the view of a large graph.
  const pinnedSelection = aroundChanges ? selection : noSelection
  const view = useMemo(
    () => projectView(index, { scopeId, perspective, flowId, aroundChanges, selection: pinnedSelection }),
    [index, scopeId, perspective, flowId, aroundChanges, pinnedSelection],
  )

  const activeCard = understanding.cards.find((card) => card.id === understanding.activeCardId) ?? null
  const whatIfShown = activeCard !== null && understanding.whatIfCardId === activeCard.id
  const activeResult = resultOf(activeCard)
  const overlay = useMemo(
    () =>
      activeResult
        ? computeOverlay(index, view.mode === 'graph' ? view : noGraph, {
            answer: activeResult.answer,
            hoverRefs: understanding.hoverRefs,
            whatIf: { shown: whatIfShown, mode: understanding.whatIfMode },
          })
        : emptyOverlay,
    [index, view, activeResult, understanding.hoverRefs, whatIfShown, understanding.whatIfMode],
  )

  const emphasizedRefs = useMemo(() => {
    if (understanding.hoverRefs) return new Set(understanding.hoverRefs)
    if (!activeResult) return new Set<string>()
    const { segments, highlights } = activeResult.answer
    return new Set([...segments.flatMap((segment) => segment.refs), ...highlights.map((highlight) => highlight.ref)])
  }, [understanding.hoverRefs, activeResult])

  // The explicit override only applies to the selection it was made on.
  const wholeViewOverride = wholeViewFor !== null && sameSelection(wholeViewFor, selection)
  const target = useMemo<QuestionTarget>(() => (wholeViewOverride ? { kind: 'view' } : targetFromSelection(selection)), [wholeViewOverride, selection])
  const targetLabel = describeTarget(index, target)
  const previous = useMemo(() => previousTurn(understanding.cards, understanding.activeCardId), [understanding.cards, understanding.activeCardId])

  // The preview leaves the question out so typing does not rebuild the context on every keystroke,
  // which is noticeable on projects with tens of thousands of nodes.
  const contextPreview = useMemo(
    () => buildQuestionContext({ index, exploration, target, question: '（送信時に質問文が入ります）', previous }),
    [index, exploration, target, previous],
  )

  const outlinedNodeIds = useMemo(() => {
    if (!previewingContext || view.mode !== 'graph') return null
    const included = new Set(contextPreview.visible.nodes.map((node) => node.id))
    const subjectIds = selectedNodeIds(target.kind === 'view' ? noSelection : target)
    return new Set(
      view.nodes.filter((viewNode) => included.has(viewNode.id) || subjectIds.some((id) => index.isWithin(id, viewNode.id))).map((viewNode) => viewNode.id),
    )
  }, [previewingContext, view, contextPreview, target, index])

  const runAsk = useCallback((card: AnswerCard) => {
    ask(card.context, card.moduleId).then(
      (result) => understand({ type: 'answered', id: card.id, result }),
      (error: unknown) => understand({ type: 'failed', id: card.id, error: error instanceof Error ? error.message : String(error) }),
    )
  }, [])

  // On a module page the question is about the brief shown, which the server needs to have generated.
  const askBlockedReason = modulePageId !== null && moduleBrief === null ? '要約ができてから質問できます' : null

  const submit = () => {
    const text = question.trim()
    if (text === '' || askBlockedReason !== null) return
    const context = buildQuestionContext({ index, exploration, target, question: text, previous })
    cardSequence.current += 1
    const card: AnswerCard = {
      id: `card-${cardSequence.current}`,
      question: text,
      target,
      targetLabel,
      viewpoint: viewpointOf(exploration),
      moduleId: modulePageId,
      context,
      reply: { status: 'pending' },
    }
    dispatch({ type: 'recordQuestion', question: text })
    understand({ type: 'asked', card })
    setQuestion('')
    runAsk(card)
  }

  const select = useCallback((next: Selection) => dispatch({ type: 'select', selection: next }), [])
  const enter = useCallback((nodeId: string) => dispatch({ type: 'enterScope', scopeId: nodeId }), [])
  const selectNode = useCallback(
    (nodeId: string, additive: boolean) =>
      additive ? dispatch({ type: 'toggleNodeInSelection', nodeId }) : dispatch({ type: 'select', selection: { kind: 'node', nodeId } }),
    [],
  )
  const selectViewEdge = useCallback(
    (edge: ViewEdge) => dispatch({ type: 'select', selection: { kind: 'edge', source: edge.source, target: edge.target, edgeIds: edge.edgeIds } }),
    [],
  )
  const selectGraphEdge = useCallback(
    (edge: GraphEdge) => dispatch({ type: 'select', selection: { kind: 'edge', source: edge.source, target: edge.target, edgeIds: [edge.id] } }),
    [],
  )
  const selectLines = useCallback((nodeId: string, lines: LineRange) => dispatch({ type: 'select', selection: { kind: 'code', nodeId, lines } }), [])
  const clearSelection = useCallback(() => dispatch({ type: 'select', selection: noSelection }), [])

  const openModulePage = useCallback((moduleId: string) => {
    setModulePageId(moduleId)
    setCodeRef(null)
    // The page's questions are about the module, so it becomes the question's target.
    dispatch({ type: 'select', selection: { kind: 'node', nodeId: moduleId } })
  }, [])

  const insideModulePage = (ref: string) => {
    if (modulePageId === null) return false
    if (index.hasNode(ref)) return index.isWithin(ref, modulePageId)
    const edge = index.edge(ref)
    return index.isWithin(edge.source, modulePageId) || index.isWithin(edge.target, modulePageId)
  }

  /** Continues exploring from an answer: brings the referenced element into view (entering its scope if needed) and selects it. */
  const focusRef = (ref: string) => {
    if (insideModulePage(ref)) {
      setCodeRef(ref)
      return
    }
    setModulePageId(null)
    focusInGraph(ref)
  }

  const focusInGraph = (ref: string) => {
    if (index.hasNode(ref)) {
      const node = index.node(ref)
      const drawn = view.mode === 'graph' && view.nodes.some((viewNode) => viewNode.id === ref)
      if (!drawn && node.parentId && node.parentId !== scopeId && canEnter(index, node.parentId)) dispatch({ type: 'enterScope', scopeId: node.parentId })
      dispatch({ type: 'select', selection: { kind: 'node', nodeId: ref } })
      return
    }
    const edge = index.edge(ref)
    const drawn = view.mode === 'graph' && view.edges.some((viewEdge) => viewEdge.edgeIds.includes(ref))
    if (!drawn) {
      const scopeCandidate = commonAncestorId(index, edge.source, edge.target)
      if (scopeCandidate !== scopeId && canEnter(index, scopeCandidate)) dispatch({ type: 'enterScope', scopeId: scopeCandidate })
    }
    selectGraphEdge(edge)
  }

  const restore = (card: AnswerCard) => {
    dispatch({ type: 'restore', viewpoint: card.viewpoint })
    setModulePageId(card.moduleId)
    understand({ type: 'activate', id: card.id })
  }

  const askBar = (docked: 'top' | 'bottom') => (
    <AskBar
      docked={docked}
      targetLabel={targetLabel}
      // On the module page there is no graph on screen to ask about as a whole.
      canSwitchTarget={docked === 'bottom' && selection.kind !== 'none'}
      wholeViewOverride={wholeViewOverride}
      onToggleWholeView={() => setWholeViewFor(wholeViewOverride ? null : selection)}
      question={question}
      onQuestionChange={setQuestion}
      onSubmit={submit}
      context={contextPreview}
      onPreviewChange={setPreviewingContext}
      blockedReason={askBlockedReason}
      moduleAttachment={moduleBrief}
    />
  )

  return (
    <div className="app">
      <TopBar index={index} exploration={exploration} config={config} dispatch={dispatch} />
      <div className="main">
        {modulePageId !== null ? (
          <div className="canvas-area module-layout">
            {askBar('top')}
            <ModulePage
              index={index}
              moduleId={modulePageId}
              state={briefState}
              onRetry={retryBrief}
              emphasizedRefs={emphasizedRefs}
              codeRef={codeRef}
              onShowCode={setCodeRef}
              onBack={() => setModulePageId(null)}
              onShowInGraph={(ref) => {
                setModulePageId(null)
                focusInGraph(ref)
              }}
            />
          </div>
        ) : (
          <div className="canvas-area">
            {view.mode === 'graph' ? (
              <CanvasErrorBoundary key={layoutKey(scopeId, perspective, flowId, aroundChanges)}>
                <GraphCanvas
                  index={index}
                  view={view}
                  layoutKey={layoutKey(scopeId, perspective, flowId, aroundChanges)}
                  perspective={perspective}
                  selection={selection}
                  overlay={overlay}
                  outlinedNodeIds={outlinedNodeIds}
                  viewports={viewports}
                  onSelectNode={selectNode}
                  onSelectEdge={selectViewEdge}
                  onEnter={enter}
                  onClearSelection={clearSelection}
                />
              </CanvasErrorBoundary>
            ) : (
              <CodeView
                index={index}
                node={view.node}
                callers={view.callers}
                callees={view.callees}
                selection={selection}
                onSelectLines={selectLines}
                onOpen={enter}
                onSelectEdge={selectGraphEdge}
              />
            )}
            <Legend
              overlay={overlay}
              whatIfToggle={whatIfShown ? { mode: understanding.whatIfMode } : null}
              onWhatIfMode={(mode) => understand({ type: 'setWhatIfMode', mode })}
              onJumpToAskedScreen={() => activeCard && dispatch({ type: 'restore', viewpoint: activeCard.viewpoint })}
            />
            {askBar('bottom')}
          </div>
        )}
        <aside className="side">
          <Inspector
            index={index}
            exploration={exploration}
            view={view}
            onSelect={select}
            onEnter={enter}
            onQuickQuestion={setQuestion}
            onFocusRef={focusRef}
            modulePageId={modulePageId}
            onOpenModulePage={openModulePage}
          />
          <ExplanationPanel
            index={index}
            cards={understanding.cards}
            activeCardId={understanding.activeCardId}
            whatIfCardId={understanding.whatIfCardId}
            onActivate={(id) => understand({ type: 'activate', id })}
            onRestore={restore}
            onRetry={(card) => {
              understand({ type: 'retry', id: card.id })
              runAsk(card)
            }}
            onFocusRef={focusRef}
            onFollowUp={(followUpQuestion, ref) => {
              if (ref) focusRef(ref)
              setQuestion(followUpQuestion)
            }}
            onHover={(refs) => understand({ type: 'hover', refs })}
            onShowWhatIf={(id) => {
              // The removal estimate is drawn on the graph, which the module page covers.
              setModulePageId(null)
              understand({ type: 'showWhatIf', id, mode: 'after' })
            }}
            onHideWhatIf={() => understand({ type: 'hideWhatIf' })}
          />
        </aside>
      </div>
    </div>
  )
}

function commonAncestorId(index: GraphIndex, a: string, b: string): string {
  const pathA = index.path(a)
  const pathB = index.path(b)
  let common = index.root.id
  for (let i = 0; i < Math.min(pathA.length, pathB.length) && pathA[i]!.id === pathB[i]!.id; i++) common = pathA[i]!.id
  return common
}
