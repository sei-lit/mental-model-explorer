import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useStore,
  type NodeTypes,
  type EdgeTypes,
  type Viewport,
} from '@xyflow/react'
import { useMemo, useRef, type RefObject } from 'react'
import type { ViewEdge } from '../../core/exploration/projectView'
import { canEnter, selectedNodeIds, type Perspective, type Selection } from '../../core/exploration/state'
import type { GraphIndex } from '../../core/model/graphIndex'
import type { GraphView, ViewOverlay } from '../overlay'
import { ConceptNode, type ConceptFlowNode } from './ConceptNode'
import { RelationEdge, type RelationFlowEdge } from './RelationEdge'
import { computeLayout, NODE_HEIGHT, NODE_WIDTH } from './layout'
import { layerColor } from '../labels'
import { nextZoomLevel, ZoomLevelContext, type ZoomLevel } from './zoomLevel'

import '@xyflow/react/dist/style.css'

const nodeTypes: NodeTypes = { concept: ConceptNode }
const edgeTypes: EdgeTypes = { relation: RelationEdge }

export interface GraphCanvasProps {
  index: GraphIndex
  view: GraphView
  layoutKey: string
  perspective: Perspective
  selection: Selection
  overlay: ViewOverlay
  /** View node ids to outline, to show what the AI would be given. */
  outlinedNodeIds: ReadonlySet<string> | null
  viewports: RefObject<Map<string, Viewport>>
  onSelectNode: (nodeId: string, additive: boolean) => void
  onSelectEdge: (edge: ViewEdge) => void
  onEnter: (nodeId: string) => void
  onClearSelection: () => void
}

/** Mounted with `key={layoutKey}`: a new layout key means a fresh canvas that fits (or restores) its viewport once. */
export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function GraphCanvasInner({
  index,
  view,
  layoutKey,
  perspective,
  selection,
  overlay,
  outlinedNodeIds,
  viewports,
  onSelectNode,
  onSelectEdge,
  onEnter,
  onClearSelection,
}: GraphCanvasProps) {
  const zoom = useStore((state) => state.transform[2])
  const zoomLevel = useRef<ZoomLevel>('mid')
  zoomLevel.current = nextZoomLevel(zoomLevel.current, zoom)

  const layout = useMemo(() => computeLayout(view), [view])
  const savedViewport = useRef(viewports.current.get(layoutKey)).current

  const selectedIds = useMemo(() => new Set(selectedNodeIds(selection)), [selection])
  const selectedEdgeIds = selection.kind === 'edge' ? selection.edgeIds : null

  const nodes = useMemo<ConceptFlowNode[]>(
    () =>
      view.nodes.map((viewNode) => {
        const emphasis = overlay.nodes.get(viewNode.id) ?? null
        return {
          id: viewNode.id,
          type: 'concept',
          position: layout.positions.get(viewNode.id) ?? { x: 0, y: 0 },
          // Node objects are rebuilt on every selection change; without initial dimensions React Flow
          // hides them until re-measured, and a double-click's second click falls through to the pane.
          initialWidth: NODE_WIDTH,
          initialHeight: NODE_HEIGHT,
          draggable: false,
          data: {
            viewNode,
            members: index.children(viewNode.id).map((child) => child.name),
            perspective,
            emphasis,
            dimmed: (overlay.active && emphasis === null) || (perspective === 'flow' && !viewNode.inFlow),
            selected: selectedIds.has(viewNode.id),
            outlined: outlinedNodeIds?.has(viewNode.id) ?? false,
            enterable: canEnter(index, viewNode.id),
            layerColor: layerColor(index.layers, viewNode.layer),
            onEnter,
          },
        }
      }),
    [view, layout, index, perspective, overlay, selectedIds, outlinedNodeIds, onEnter],
  )

  const edges = useMemo<RelationFlowEdge[]>(() => {
    const siblingCount = new Map<string, number>()
    return view.edges.map((viewEdge) => {
      const pair = [viewEdge.source, viewEdge.target].sort().join('|')
      const order = siblingCount.get(pair) ?? 0
      siblingCount.set(pair, order + 1)
      const emphasis = overlay.edges.get(viewEdge.id) ?? null
      const traceSteps = overlay.traceSteps.get(viewEdge.id) ?? []
      const classes = [
        `relation-${viewEdge.relation}`,
        emphasis ? `emphasis-${emphasis}` : '',
        overlay.active && emphasis === null ? 'dimmed' : '',
        viewEdge.concerns.includes('layerViolation') ? 'violation' : '',
        viewEdge.inferred ? 'inferred' : '',
        selectedEdgeIds?.some((id) => viewEdge.edgeIds.includes(id)) ? 'selected' : '',
        traceSteps.length > 0 ? 'trace' : '',
      ]
      return {
        id: viewEdge.id,
        source: viewEdge.source,
        target: viewEdge.target,
        type: 'relation',
        className: classes.filter(Boolean).join(' '),
        markerEnd: viewEdge.relation === 'implements' ? 'url(#mme-arrow-hollow)' : 'url(#mme-arrow)',
        data: {
          viewEdge,
          showFlowSteps: perspective === 'flow',
          traceSteps,
          labelOffset: order * 20,
          bends: layout.bends.get(viewEdge.id) ?? null,
          onSelect: onSelectEdge,
        },
      }
    })
  }, [view, layout, overlay, selectedEdgeIds, perspective, onSelectEdge])

  return (
    <ZoomLevelContext.Provider value={zoomLevel.current}>
      <svg className="marker-defs" width="0" height="0" aria-hidden>
        <defs>
          <marker id="mme-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
          <marker id="mme-arrow-hollow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M 1 1 L 9 5 L 1 9 z" fill="#fff" stroke="context-stroke" strokeWidth="1.2" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2}
        {...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true, fitViewOptions: { padding: 0.2, maxZoom: 1 } })}
        onMoveEnd={(_event, viewport) => viewports.current.set(layoutKey, viewport)}
        onNodeClick={(event, node) => onSelectNode(node.id, event.shiftKey || event.metaKey || event.ctrlKey)}
        onNodeDoubleClick={(_event, node) => onEnter(node.id)}
        onPaneClick={onClearSelection}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
      </ReactFlow>
    </ZoomLevelContext.Provider>
  )
}
