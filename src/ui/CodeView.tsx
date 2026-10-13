import type { GraphEdge, GraphNode } from '../core/model/graph'
import type { GraphIndex } from '../core/model/graphIndex'
import type { LineRange, Selection } from '../core/exploration/state'

interface CodeViewProps {
  index: GraphIndex
  node: GraphNode
  callers: GraphEdge[]
  callees: GraphEdge[]
  selection: Selection
  onSelectLines: (nodeId: string, lines: LineRange) => void
  onOpen: (nodeId: string) => void
  onSelectEdge: (edge: GraphEdge) => void
}

export function CodeView({ index, node, callers, callees, selection, onSelectLines, onOpen, onSelectEdge }: CodeViewProps) {
  const selected = selection.kind === 'code' && selection.nodeId === node.id ? selection.lines : null

  const clickLine = (line: number, extend: boolean) => {
    if (extend && selected) onSelectLines(node.id, { from: Math.min(selected.from, line), to: Math.max(selected.to, line) })
    else onSelectLines(node.id, { from: line, to: line })
  }

  return (
    <div className="code-view">
      <div className="code-header">
        <strong>{node.name}</strong>
        {node.code && <span className="muted">{node.code.path}</span>}
      </div>
      {node.code ? (
        <pre className="code-block">
          {node.code.text.split('\n').map((text, i) => {
            const line = node.code!.startLine + i
            const isSelected = selected !== null && line >= selected.from && line <= selected.to
            return (
              <div key={line} className={isSelected ? 'code-line selected' : 'code-line'} onClick={(event) => clickLine(line, event.shiftKey)}>
                <span className="line-number">{line}</span>
                <code>{text || ' '}</code>
              </div>
            )
          })}
        </pre>
      ) : (
        <p className="muted">この要素にはコードがありません。</p>
      )}
      <div className="code-relations">
        <CallList title="呼び出し元" edges={callers} pick={(edge) => edge.source} index={index} onOpen={onOpen} onSelectEdge={onSelectEdge} />
        <CallList title="呼び出し先" edges={callees} pick={(edge) => edge.target} index={index} onOpen={onOpen} onSelectEdge={onSelectEdge} />
      </div>
    </div>
  )
}

interface CallListProps {
  title: string
  edges: GraphEdge[]
  pick: (edge: GraphEdge) => string
  index: GraphIndex
  onOpen: (nodeId: string) => void
  onSelectEdge: (edge: GraphEdge) => void
}

function CallList({ title, edges, pick, index, onOpen, onSelectEdge }: CallListProps) {
  return (
    <div>
      <h4>{title}</h4>
      {edges.length === 0 && <span className="muted">なし</span>}
      <div className="chip-row">
        {edges.map((edge) => {
          const other = index.node(pick(edge))
          const owner = other.parentId ? index.node(other.parentId).name : null
          return (
            <span key={edge.id} className="chip-group">
              <button className="chip" onClick={() => onOpen(other.id)} title="このメソッドを開く">
                {owner ? `${owner}.` : ''}
                {other.name}
              </button>
              <button className="chip chip-minor" onClick={() => onSelectEdge(edge)} title="この呼び出しを選択">
                関係
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}
