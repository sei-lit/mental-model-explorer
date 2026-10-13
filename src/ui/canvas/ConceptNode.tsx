import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { ViewNode } from '../../core/exploration/projectView'
import type { Perspective } from '../../core/exploration/state'
import type { Emphasis } from '../overlay'
import { kindIcon, kindText, provenanceLabel } from '../labels'
import { NODE_HEIGHT, NODE_WIDTH } from './layout'
import { useZoomLevel } from './zoomLevel'

export interface ConceptNodeData extends Record<string, unknown> {
  viewNode: ViewNode
  members: string[]
  perspective: Perspective
  emphasis: Emphasis | null
  dimmed: boolean
  selected: boolean
  outlined: boolean
  enterable: boolean
  layerColor: string | null
  onEnter: (nodeId: string) => void
}

export type ConceptFlowNode = Node<ConceptNodeData, 'concept'>

const MAX_MEMBERS = 8

export function ConceptNode({ data }: NodeProps<ConceptFlowNode>) {
  const { viewNode, perspective, emphasis, dimmed, selected, outlined, enterable, onEnter, members } = data
  const { node } = viewNode
  const zoom = useZoomLevel()
  const classes = [
    'concept-node',
    `role-${viewNode.role}`,
    emphasis ? `emphasis-${emphasis}` : '',
    dimmed ? 'dimmed' : '',
    selected ? 'selected' : '',
    outlined ? 'outlined' : '',
    perspective === 'flow' && !viewNode.inFlow ? 'out-of-flow' : '',
    enterable ? 'enterable' : '',
  ]

  return (
    <div className={classes.filter(Boolean).join(' ')} style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <div className="layer-stripe" style={data.layerColor ? { background: data.layerColor } : undefined} />
      <div className="node-body">
        <div className="node-title">
          <span className="kind-icon" title={kindText(node)}>
            {kindIcon(node)}
          </span>
          <span className="node-name">{node.name}</span>
          {viewNode.role === 'context' && <span className="badge">範囲外</span>}
        </div>
        {zoom !== 'far' && (
          <>
            <div className="node-kind">{kindText(node)}</div>
            {perspective === 'responsibility' ? (
              <ResponsibilityLine node={node} />
            ) : (
              node.summary && <div className="node-summary">{node.summary}</div>
            )}
          </>
        )}
        {zoom === 'near' && <Members members={members} childCount={viewNode.childCount} />}
      </div>
      {enterable && (
        <button
          className="enter-button nodrag nopan"
          onClick={(event) => {
            event.stopPropagation()
            onEnter(viewNode.id)
          }}
        >
          ⤵ 開く
        </button>
      )}
    </div>
  )
}

function ResponsibilityLine({ node }: { node: ViewNode['node'] }) {
  if (!node.responsibility) return <div className="node-summary muted">責務の記述なし</div>
  return (
    <div className="node-summary">
      <span className={`badge provenance-${node.responsibility.provenance}`}>{provenanceLabel[node.responsibility.provenance]}</span>{' '}
      {node.responsibility.text}
    </div>
  )
}

function Members({ members, childCount }: { members: string[]; childCount: number }) {
  if (childCount === 0) return null
  const shown = members.slice(0, MAX_MEMBERS)
  return (
    <div className="node-members">
      {shown.map((name) => (
        <span key={name} className="member-chip">
          {name}
        </span>
      ))}
      {childCount > shown.length && <span className="member-chip muted">+{childCount - shown.length}</span>}
    </div>
  )
}
