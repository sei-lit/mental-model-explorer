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
import { GraphCanvas } from './canvas/GraphCanvas'
import { layoutKey } from './canvas/layout'
import { computeOverlay, emptyOverlay, type GraphView } from './overlay'
import { initialUnderstanding, lastDoneCard, understandingReducer, type AnswerCard } from './understandingState'

const noGraph = { nodes: [], edges: [] } satisfies Pick<GraphView, 'nodes' | 'edges'>

export function Workspace({ graph, config }: { graph: ProjectGraph; config: ClientConfig }) {
  const index = useMemo(() => new GraphIndex(graph), [graph])
  const reducer = useMemo(() => createExplorationReducer(index), [index])
  const [exploration, dispatch] = useReducer(reducer, index, initialExploration)
  const [understanding, understand] = useReducer(understandingReducer, initialUnderstanding)

  const [question, setQuestion] = useState('')
  const [wholeViewFor, setWholeViewFor] = useState<Selection | null>(null)
  const [previewingContext, setPreviewingContext] = useState(false)
  const viewports = useRef(new Map<string, Viewport>())
  const cardSequence = useRef(0)

  const { scopeId, perspective, flowId, selection } = exploration
  const view = useMemo(
    () => projectView(index, { scopeId, perspective, flowId, selection: noSelection }),
    [index, scopeId, perspective, flowId],
  )

  const activeCard = understanding.cards.find((card) => card.id === understanding.activeCardId) ?? null
  const whatIfShown = activeCard !== null && understanding.whatIfCardId === activeCard.id
  const overlay = useMemo(
    () =>
      activeCard?.result
        ? computeOverlay(index, view.mode === 'graph' ? view : noGraph, {
            answer: activeCard.result.answer,
            hoverRefs: understanding.hoverRefs,
            whatIf: { shown: whatIfShown, mode: understanding.whatIfMode },
          })
        : emptyOverlay,
    [index, view, activeCard?.result, understanding.hoverRefs, whatIfShown, understanding.whatIfMode],
  )

  // The explicit override only applies to the selection it was made on.
  const wholeViewOverride = wholeViewFor !== null && sameSelection(wholeViewFor, selection)
  const target: QuestionTarget = wholeViewOverride ? { kind: 'view' } : targetFromSelection(selection)
  const targetLabel = describeTarget(index, target)
  const previous = lastDoneCard(understanding.cards)
  const previousTurn = previous?.result ? { question: previous.question, summary: previous.result.answer.summary } : null

  const contextPreview = useMemo(
    () => buildQuestionContext({ index, exploration, target, question: question.trim() || '（質問を入力するとここに入ります）', previous: previousTurn }),
    // `previousTurn` is rebuilt every render; its content only changes with the cards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, exploration, target.kind, targetLabel, question, previous?.id],
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
    ask(card.context).then(
      (result) => understand({ type: 'answered', id: card.id, result }),
      (error: unknown) => understand({ type: 'failed', id: card.id, error: error instanceof Error ? error.message : String(error) }),
    )
  }, [])

  const submit = () => {
    const text = question.trim()
    if (text === '') return
    const context = buildQuestionContext({ index, exploration, target, question: text, previous: previousTurn })
    cardSequence.current += 1
    const card: AnswerCard = {
      id: `card-${cardSequence.current}`,
      question: text,
      target,
      targetLabel,
      viewpoint: viewpointOf(exploration),
      context,
      status: 'pending',
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

  /** Continues exploring from an answer: brings the referenced element into view (entering its scope if needed) and selects it. */
  const focusRef = (ref: string) => {
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
    understand({ type: 'activate', id: card.id })
  }

  return (
    <div className="app">
      <TopBar index={index} exploration={exploration} config={config} dispatch={dispatch} />
      <div className="main">
        <div className="canvas-area">
          {view.mode === 'graph' ? (
            <GraphCanvas
              key={layoutKey(scopeId, perspective, flowId)}
              index={index}
              view={view}
              layoutKey={layoutKey(scopeId, perspective, flowId)}
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
          <AskBar
            targetLabel={targetLabel}
            canSwitchTarget={selection.kind !== 'none'}
            wholeViewOverride={wholeViewOverride}
            onToggleWholeView={() => setWholeViewFor(wholeViewOverride ? null : selection)}
            question={question}
            onQuestionChange={setQuestion}
            onSubmit={submit}
            context={contextPreview}
            onPreviewChange={setPreviewingContext}
          />
        </div>
        <aside className="side">
          <Inspector index={index} exploration={exploration} view={view} onSelect={select} onEnter={enter} onQuickQuestion={setQuestion} />
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
            onShowWhatIf={(id) => understand({ type: 'showWhatIf', id, mode: 'after' })}
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
