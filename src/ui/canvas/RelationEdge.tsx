import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { ViewEdge } from '../../core/exploration/projectView'
import { relationLabel, stepMark } from '../labels'
import { smoothPath, type Position } from './layout'

export interface RelationEdgeData extends Record<string, unknown> {
  viewEdge: ViewEdge
  showFlowSteps: boolean
  traceSteps: number[]
  /** Offsets labels of edges that share the same endpoints so they do not overlap. */
  labelOffset: number
  bends: Position[] | null
  onSelect: (edge: ViewEdge) => void
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>

export function RelationEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<RelationFlowEdge>) {
  if (!data) return null
  const { viewEdge, showFlowSteps, traceSteps, labelOffset, bends, onSelect } = data
  const [path, labelX, labelY] = bends
    ? routedPath({ x: sourceX, y: sourceY }, bends, { x: targetX, y: targetY })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
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

function routedPath(source: Position, bends: Position[], target: Position): [string, number, number] {
  const middle = bends[Math.floor(bends.length / 2)]!
  return [smoothPath([source, ...bends, target]), middle.x, middle.y]
}
