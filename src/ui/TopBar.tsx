import { flowsThrough, type ExplorationAction, type ExplorationState, type Perspective } from '../core/exploration/state'
import type { GraphIndex } from '../core/model/graphIndex'
import type { ClientConfig } from './api/client'
import { perspectiveLabel } from './labels'

interface TopBarProps {
  index: GraphIndex
  exploration: ExplorationState
  config: ClientConfig
  dispatch: (action: ExplorationAction) => void
}

const perspectives: Perspective[] = ['structure', 'responsibility', 'flow']

export function TopBar({ index, exploration, config, dispatch }: TopBarProps) {
  const path = index.path(exploration.scopeId)
  const hasFlows = index.graph.flows.length > 0
  return (
    <header className="top-bar">
      <div className="history-buttons">
        <button onClick={() => dispatch({ type: 'back' })} disabled={exploration.historyIndex === 0} title="戻る">
          ←
        </button>
        <button
          onClick={() => dispatch({ type: 'forward' })}
          disabled={exploration.historyIndex >= exploration.history.length - 1}
          title="進む"
        >
          →
        </button>
      </div>
      <nav className="breadcrumb" aria-label="表示範囲">
        {path.map((node, i) => (
          <span key={node.id}>
            {i > 0 && <span className="separator"> › </span>}
            {i < path.length - 1 ? (
              <button className="crumb" onClick={() => dispatch({ type: 'enterScope', scopeId: node.id })}>
                {node.name}
              </button>
            ) : (
              <span className="crumb current">{node.name}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="perspective-tabs" role="tablist">
        {perspectives.map((perspective) => (
          <button
            key={perspective}
            role="tab"
            aria-selected={exploration.perspective === perspective}
            className={exploration.perspective === perspective ? 'tab active' : 'tab'}
            disabled={perspective === 'flow' && !hasFlows}
            onClick={() => dispatch({ type: 'setPerspective', perspective })}
          >
            {perspectiveLabel[perspective]}
          </button>
        ))}
        {exploration.perspective === 'flow' && exploration.flowId && (
          <FlowSelect index={index} scopeId={exploration.scopeId} flowId={exploration.flowId} onChange={(flowId) => dispatch({ type: 'setFlow', flowId })} />
        )}
      </div>
      <div className="responder-status" title="回答の生成元">
        AI: {config.responder === 'claude-cli' ? `claude CLI${config.model ? ` (${config.model})` : ''}` : 'モック'}
      </div>
    </header>
  )
}

function FlowSelect({ index, scopeId, flowId, onChange }: { index: GraphIndex; scopeId: string; flowId: string; onChange: (flowId: string) => void }) {
  const relevant = new Set(flowsThrough(index, scopeId))
  const option = (flow: { id: string; name: string }) => (
    <option key={flow.id} value={flow.id}>
      {flow.name}
    </option>
  )
  return (
    <select value={flowId} onChange={(event) => onChange(event.target.value)}>
      <optgroup label={`この範囲を通る流れ（${relevant.size}）`}>{index.graph.flows.filter((flow) => relevant.has(flow.id)).map(option)}</optgroup>
      <optgroup label="ほかの流れ">{index.graph.flows.filter((flow) => !relevant.has(flow.id)).map(option)}</optgroup>
    </select>
  )
}
