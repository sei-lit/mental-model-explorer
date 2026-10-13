import type { VisibleView } from '../core/exploration/projectView'
import { canEnter, type ExplorationState, type Selection } from '../core/exploration/state'
import type { Claim, GraphEdge } from '../core/model/graph'
import type { GraphIndex } from '../core/model/graphIndex'
import { kindText, layerColor, perspectiveLabel, provenanceLabel, qualifiedName, relationLabel } from './labels'

interface InspectorProps {
  index: GraphIndex
  exploration: ExplorationState
  view: VisibleView
  onSelect: (selection: Selection) => void
  onEnter: (nodeId: string) => void
  onQuickQuestion: (question: string) => void
  onFocusRef: (ref: string) => void
  /** The module whose page is open, if any. */
  modulePageId: string | null
  onOpenModulePage: (moduleId: string) => void
}

export function Inspector({ index, exploration, view, onSelect, onEnter, onQuickQuestion, onFocusRef, modulePageId, onOpenModulePage }: InspectorProps) {
  const { selection } = exploration
  // The module page explains the module itself; repeating the analysis-time description here would
  // put the rule-based text the page replaces right next to it.
  if (modulePageId !== null) {
    return (
      <section className="inspector panel">
        <h3>{index.node(modulePageId).name} を理解する</h3>
        <p className="muted">左のページは AI がソースから作った要約です。わからないところは上の欄から質問できます。回答の根拠はページのコードで確認できます。</p>
        <Suggestions index={index} selection={selection} modulePageOpen onQuickQuestion={onQuickQuestion} />
      </section>
    )
  }
  return (
    <section className="inspector panel">
      {selection.kind === 'none' && <ScopeSummary index={index} exploration={exploration} view={view} />}
      {selection.kind === 'none' && <ChangesInScope index={index} scopeId={exploration.scopeId} onFocusRef={onFocusRef} />}
      {selection.kind === 'node' && (
        <NodeDetail index={index} nodeId={selection.nodeId} onSelect={onSelect} onEnter={onEnter} onOpenModulePage={onOpenModulePage} />
      )}
      {selection.kind === 'nodes' && <NodesDetail index={index} nodeIds={selection.nodeIds} onSelect={onSelect} />}
      {selection.kind === 'edge' && <EdgeDetail index={index} selection={selection} onSelect={onSelect} />}
      {selection.kind === 'code' && (
        <div>
          <h3>{index.node(selection.nodeId).name}</h3>
          <p>
            {selection.lines.from === selection.lines.to
              ? `${selection.lines.from} 行目を選択中`
              : `${selection.lines.from}–${selection.lines.to} 行目を選択中`}
          </p>
        </div>
      )}
      <Suggestions index={index} selection={selection} modulePageOpen={false} onQuickQuestion={onQuickQuestion} />
    </section>
  )
}

function ScopeSummary({ index, exploration, view }: { index: GraphIndex; exploration: ExplorationState; view: VisibleView }) {
  const scope = index.node(exploration.scopeId)
  return (
    <div>
      <h3>表示中: {scope.name}</h3>
      {scope.summary && <p>{scope.summary}</p>}
      {view.mode === 'graph' ? (
        <p className="muted">
          {perspectiveLabel[exploration.perspective]}の視点で、{scope.name} の内部の要素 {view.nodes.filter((n) => n.role === 'member').length} 件と、
          つながる範囲外の要素 {view.nodes.filter((n) => n.role === 'context').length} 件、関係 {view.edges.length} 本を表示しています。
          要素や関係をクリックすると詳細が出ます。
        </p>
      ) : (
        <p className="muted">コードを表示しています。行をクリックすると、その行について質問できます。</p>
      )}
    </div>
  )
}

const MAX_LISTED_CHANGES = 20

function ChangesInScope({ index, scopeId, onFocusRef }: { index: GraphIndex; scopeId: string; onFocusRef: (ref: string) => void }) {
  const changes = index.graph.changes
  if (!changes) return null
  const inScope = changes.nodeIds.filter((id) => index.isWithin(id, scopeId))
  return (
    <div className="changes-in-scope">
      <h4>
        {changes.url ? (
          <a href={changes.url} target="_blank" rel="noreferrer">
            {changes.title}
          </a>
        ) : (
          changes.title
        )}
      </h4>
      {changes.warnings.map((warning) => (
        <p key={warning} className="warning">
          ⚠ {warning}
        </p>
      ))}
      <p className="muted">
        この範囲で変更された宣言 {inScope.length} 件（全体 {changes.nodeIds.length} 件・{changes.files.length} ファイル）
      </p>
      <ul>
        {inScope.slice(0, MAX_LISTED_CHANGES).map((id) => (
          <li key={id}>
            <button className="link-button" onClick={() => onFocusRef(id)} title={index.path(id).map((node) => node.name).join(' > ')}>
              {qualifiedName(index, id)}
            </button>
          </li>
        ))}
        {inScope.length > MAX_LISTED_CHANGES && <li className="muted">ほか {inScope.length - MAX_LISTED_CHANGES} 件</li>}
      </ul>
    </div>
  )
}

/** Members are listed with their type ("ViewModel.init"); a bare "init" or "body" says nothing in a list. */
interface NodeDetailProps {
  index: GraphIndex
  nodeId: string
  onSelect: (s: Selection) => void
  onEnter: (id: string) => void
  onOpenModulePage: (moduleId: string) => void
}

function NodeDetail({ index, nodeId, onSelect, onEnter, onOpenModulePage }: NodeDetailProps) {
  const node = index.node(nodeId)
  const layer = index.layerOf(nodeId)
  const color = layerColor(index.layers, layer)
  const members = index.children(nodeId)
  const edges = index.edgesTouching(nodeId)
  const outgoing = edges.filter((edge) => edge.source === nodeId)
  const incoming = edges.filter((edge) => edge.target === nodeId)
  return (
    <div>
      <h3>{node.name}</h3>
      <div className="meta">
        <span className="badge">{kindText(node)}</span>
        {layer && (
          <span className="badge layer-badge" style={{ color: color ?? undefined, borderColor: color ?? undefined }}>
            {layer.label}
          </span>
        )}
        {canEnter(index, nodeId) && (
          <button className="link-button" onClick={() => onEnter(nodeId)}>
            開く
          </button>
        )}
      </div>
      <div className="muted path">{index.path(nodeId).map((n) => n.name).join(' › ')}</div>
      {node.kind === 'module' && (
        <button className="primary understand-button" onClick={() => onOpenModulePage(nodeId)}>
          このモジュールを理解する →
        </button>
      )}
      {node.summary && <p>{node.summary}</p>}
      <ClaimLine label="責務" claim={node.responsibility} />
      <ClaimLine label="役割" claim={node.role} />
      {node.constraints?.map((claim, i) => <ClaimLine key={i} label="制約" claim={claim} />)}
      {members.length > 0 && (
        <>
          <h4>含まれる要素</h4>
          <div className="chip-row">
            {members.map((member) => (
              <button
                key={member.id}
                className="chip"
                onClick={() => onSelect({ kind: 'node', nodeId: member.id })}
                onDoubleClick={() => onEnter(member.id)}
                title="クリックで選択 / ダブルクリックで開く"
              >
                {member.name}
              </button>
            ))}
          </div>
        </>
      )}
      <RelationList title="使っている / 出ていく関係" edges={outgoing} index={index} nodeId={nodeId} onSelect={onSelect} />
      <RelationList title="使われている / 入ってくる関係" edges={incoming} index={index} nodeId={nodeId} onSelect={onSelect} />
    </div>
  )
}

function RelationList({ title, edges, index, nodeId, onSelect }: { title: string; edges: GraphEdge[]; index: GraphIndex; nodeId: string; onSelect: (s: Selection) => void }) {
  if (edges.length === 0) return null
  return (
    <>
      <h4>{title}</h4>
      <ul className="relation-list">
        {edges.map((edge) => {
          const otherId = edge.source === nodeId ? edge.target : edge.source
          return (
            <li key={edge.id}>
              <button
                className="list-button"
                onClick={() => onSelect({ kind: 'edge', source: edge.source, target: edge.target, edgeIds: [edge.id] })}
              >
                <span className="badge">{relationLabel[edge.relation]}</span> {index.node(otherId).name}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function ClaimLine({ label, claim }: { label: string; claim: Claim | undefined }) {
  if (!claim) return null
  return (
    <p className="claim">
      <strong>{label}:</strong> {claim.text}{' '}
      <span className={`badge provenance-${claim.provenance}`}>{provenanceLabel[claim.provenance]}</span>
      {claim.source && <span className="muted"> {claim.source}</span>}
    </p>
  )
}

function NodesDetail({ index, nodeIds, onSelect }: { index: GraphIndex; nodeIds: string[]; onSelect: (s: Selection) => void }) {
  return (
    <div>
      <h3>{nodeIds.length} 件を選択中</h3>
      <ul className="relation-list">
        {nodeIds.map((id) => (
          <li key={id}>
            <button className="list-button" onClick={() => onSelect({ kind: 'node', nodeId: id })}>
              {index.node(id).name} <span className="muted">{kindText(index.node(id))}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EdgeDetail({ index, selection, onSelect }: { index: GraphIndex; selection: Extract<Selection, { kind: 'edge' }>; onSelect: (s: Selection) => void }) {
  const edges = selection.edgeIds.map((id) => index.edge(id))
  const byRelation = new Map<string, number>()
  for (const edge of edges) byRelation.set(edge.relation, (byRelation.get(edge.relation) ?? 0) + 1)
  return (
    <div>
      <h3>
        {index.node(selection.source).name} → {index.node(selection.target).name}
      </h3>
      <div className="meta">
        {[...byRelation].map(([relation, count]) => (
          <span key={relation} className="badge">
            {relationLabel[relation as GraphEdge['relation']]} {edges.length > 1 ? `×${count}` : ''}
          </span>
        ))}
      </div>
      {edges.length > 1 && <p className="muted">この線は {edges.length} 本の実際の関係をまとめたものです。</p>}
      <ul className="edge-evidence">
        {edges.map((edge) => (
          <li key={edge.id}>
            <button
              className="list-button"
              onClick={() => onSelect({ kind: 'edge', source: edge.source, target: edge.target, edgeIds: [edge.id] })}
            >
              <strong>
                {index.node(edge.source).name} → {index.node(edge.target).name}
              </strong>{' '}
              <span className="badge">{relationLabel[edge.relation]}</span>
            </button>
            <ClaimLine label="根拠" claim={edge.evidence} />
            <ClaimLine label="理由" claim={edge.rationale} />
          </li>
        ))}
      </ul>
    </div>
  )
}

interface SuggestionsProps {
  index: GraphIndex
  selection: Selection
  modulePageOpen: boolean
  onQuickQuestion: (question: string) => void
}

function Suggestions({ index, selection, modulePageOpen, onQuickQuestion }: SuggestionsProps) {
  const questions: string[] = []
  if (modulePageOpen) {
    questions.push('このモジュールが無かったら何が壊れる？', '代表的な処理の流れを順に説明して', '隣のモジュールとどう分担している？')
  } else {
    switch (selection.kind) {
      case 'node':
        questions.push('このモジュールの責務は？', `「${index.node(selection.nodeId).name}」を削除するとどうなる？`)
        break
      case 'edge':
        questions.push('なぜこの依存関係が必要なの？')
        break
      case 'nodes':
        break
      case 'code':
        questions.push('この処理は何を保証している？')
        break
      case 'none':
        questions.push('この構造の特徴は？')
        break
    }
  }
  if (index.graph.changes) questions.push('この PR は何を変えた？影響しうるのはどこ？')
  return (
    <div className="suggestions">
      {selection.kind === 'nodes' && (
        <button className="suggestion" onClick={() => onQuickQuestion('この二つの責務はどう違う？')}>
          比較して質問
        </button>
      )}
      {questions.map((question) => (
        <button key={question} className="suggestion" onClick={() => onQuickQuestion(question)}>
          {question}
        </button>
      ))}
    </div>
  )
}
