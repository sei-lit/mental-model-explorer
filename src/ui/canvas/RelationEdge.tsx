import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { ViewEdge } from '../../core/exploration/projectView'
import { relationLabel, stepMark } from '../labels'

export interface RelationEdgeData extends Record<string, unknown> {
  viewEdge: ViewEdge
  showFlowSteps: boolean
  traceSteps: number[]
  /** Offsets labels of edges that share the same endpoints so they do not overlap. */
  labelOffset: number
  onSelect: (edge: ViewEdge) => void
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>

export function RelationEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<RelationFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  if (!data) return null
  const { viewEdge, showFlowSteps, traceSteps, labelOffset, onSelect } = data
  const violation = viewEdge.concerns.includes('layerViolation')
  const text = [
    violation ? '⚠' : '',
    relationLabel[viewEdge.relation],
    viewEdge.aggregated ? `×${viewEdge.edgeIds.length}` : '',
    showFlowSteps ? viewEdge.flowSteps.map(stepMark).join('') : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={24} />
      <EdgeLabelRenderer>
        <div
          className="edge-label nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + labelOffset}px)` }}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(viewEdge)
          }}
        >
          {traceSteps.map((step) => (
            <span key={step} className="trace-badge">
              {step}
            </span>
          ))}
          {text}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
