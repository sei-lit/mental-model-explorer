import { useEffect, useRef, useState } from 'react'
import type { GraphIndex } from '../../core/model/graphIndex'
import type { BriefSection, ModuleBrief, ModuleBriefResult } from '../../core/understanding/moduleBrief'
import { qualifiedName } from '../labels'
import { typesByResponsibility } from './implementation'
import { MAX_SEQUENCE_LANES, sequenceOf } from './sequence'
import type { BriefState } from './useModuleBrief'

interface ModulePageProps {
  index: GraphIndex
  moduleId: string
  state: BriefState | null
  onRetry: () => void
  /** Ids an answer is pointing at; their evidence chips are emphasized. */
  emphasizedRefs: ReadonlySet<string>
  /** The declaration whose code is shown; set by evidence chips here and by answers in the side panel. */
  codeRef: string | null
  onShowCode: (ref: string) => void
  onBack: () => void
  /** Leaves the page to show a module outside it in the graph. */
  onShowInGraph: (ref: string) => void
}

export function ModulePage(props: ModulePageProps) {
  const { index, moduleId, state, onRetry, onBack } = props
  const module = index.node(moduleId)
  return (
    <div className="module-page">
      <header className="module-header">
        <button className="link-button" onClick={onBack}>
          ← グラフに戻る
        </button>
        <div className="muted path">{index.path(moduleId).map((node) => node.name).join(' › ')}</div>
        <h2>{module.name}</h2>
      </header>
      {state === null || state.status === 'loading' ? (
        <Generating startedAt={state?.status === 'loading' ? state.startedAt : Date.now()} />
      ) : state.status === 'error' ? (
        <div className="module-error">
          <p>要約を作れませんでした: {state.message}</p>
          <button onClick={onRetry}>もう一度作る</button>
        </div>
      ) : (
        <BriefBody {...props} result={state.result} />
      )}
    </div>
  )
}

function Generating({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <p className="module-generating">
      AI がこのモジュールのソースを読んで要約を作っています（{Math.round((now - startedAt) / 1000)} 秒）。初回は 1 分ほどかかります。2 回目からは保存した要約を使います。
    </p>
  )
}

const sectionLabel: Record<BriefSection, string> = {
  purpose: '目的',
  responsibilities: '責務',
  publicInterface: '入口',
  state: '状態',
  collaborators: '協働',
  scenarios: '流れ',
  boundaries: '分担',
  ifAbsent: '無かったら',
}

function BriefBody(props: ModulePageProps & { result: ModuleBriefResult }) {
  const { index, moduleId, result } = props
  const { brief } = result
  const lines = result.manifest.files.reduce((sum, file) => sum + file.lines, 0)
  const chips = (ids: string[]) => <EvidenceChips index={index} ids={ids} emphasized={props.emphasizedRefs} onShow={props.onShowCode} />

  return (
    <>
      {brief.purpose ? (
        <p className="module-purpose">
          {brief.purpose.text}
          {chips(brief.purpose.evidence)}
        </p>
      ) : (
        <p className="warning">目的を根拠付きで説明できませんでした。</p>
      )}
      <p className="muted module-provenance">
        <span className="badge provenance-inferred">AI の要約</span>{' '}
        {result.generatedBy === 'mock' ? 'モック応答' : `claude（${result.model}）`}がソース {result.manifest.files.length} ファイル・{lines} 行から作りました
        {result.cached ? '（保存済みの要約）' : ''}。各文の根拠をクリックすると、そのコードを表示します。
      </p>
      {(result.partial || result.dropped.length > 0) && (
        <p className="warning">
          {result.partial ? '要約の一部しか根拠付きで作れませんでした。' : ''}
          {result.dropped.length > 0 &&
            `根拠を示せなかった ${result.dropped.length} 文を省きました（${[...new Set(result.dropped.map((d) => sectionLabel[d.section]))].join('・')}）。`}
        </p>
      )}
      <nav className="module-toc">
        <a href="#module-what">1. 何をするか</a>
        <a href="#module-how">2. どう動くか</a>
        <a href="#module-why">3. なぜこの形か</a>
        <a href="#module-code">4. 実装</a>
      </nav>

      <section id="module-what" className="module-section">
        <h3>1. 何をするか</h3>
        <div className="responsibility-grid">
          {brief.responsibilities.map((item) => (
            <div key={item.title} className="responsibility-card">
              <h4>{item.title}</h4>
              <p>{item.text}</p>
              {chips(item.evidence)}
            </div>
          ))}
        </div>
        <NamedList title="呼び出し側が使う入口" items={brief.publicInterface} chips={chips} />
        <NamedList title="持っている状態" items={brief.state} chips={chips} />
      </section>

      <section id="module-how" className="module-section">
        <h3>2. どう動くか</h3>
        <Scenarios index={index} moduleId={moduleId} scenarios={brief.scenarios} chips={chips} />
        <Collaborators {...props} brief={brief} result={result} chips={chips} />
      </section>

      <section id="module-why" className="module-section">
        <h3>3. なぜこの形か</h3>
        <ClaimList title="分担" items={brief.boundaries} chips={chips} />
        <ClaimList title="このモジュールが無かったら" items={brief.ifAbsent} chips={chips} />
        {brief.unknowns.length > 0 && (
          <>
            <h4>コードからは断定できないこと</h4>
            <ul className="unknowns">
              {brief.unknowns.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section id="module-code" className="module-section">
        <h3>4. 実装</h3>
        <Implementation {...props} brief={brief} result={result} />
      </section>
    </>
  )
}

type Chips = (ids: string[]) => React.ReactNode

function NamedList({ title, items, chips }: { title: string; items: { name: string; text: string; evidence: string[] }[]; chips: Chips }) {
  if (items.length === 0) return null
  return (
    <>
      <h4>{title}</h4>
      <ul className="named-list">
        {items.map((item) => (
          <li key={item.name}>
            <strong>{item.name}</strong> — {item.text}
            {chips(item.evidence)}
          </li>
        ))}
      </ul>
    </>
  )
}

function ClaimList({ title, items, chips }: { title: string; items: { text: string; evidence: string[] }[]; chips: Chips }) {
  if (items.length === 0) return null
  return (
    <>
      <h4>{title}</h4>
      <ul className="named-list">
        {items.map((item) => (
          <li key={item.text}>
            {item.text}
            {chips(item.evidence)}
          </li>
        ))}
      </ul>
    </>
  )
}

function Scenarios({ index, moduleId, scenarios, chips }: { index: GraphIndex; moduleId: string; scenarios: ModuleBrief['scenarios']; chips: Chips }) {
  const [selected, setSelected] = useState(0)
  const scenario = scenarios[Math.min(selected, scenarios.length - 1)]
  if (!scenario) return <p className="muted">代表的な処理の流れは、根拠付きで作れませんでした。</p>
  const sequence = sequenceOf(index, moduleId, scenario.steps)
  return (
    <div className="scenarios">
      <h4>代表的な流れ</h4>
      <div className="scenario-tabs">
        {scenarios.map((item, i) => (
          <button key={item.name} className={`tab ${item === scenario ? 'active' : ''}`} onClick={() => setSelected(i)}>
            {item.name}
          </button>
        ))}
      </div>
      <p className="muted">きっかけ: {scenario.trigger}</p>
      {sequence.lanes.length <= MAX_SEQUENCE_LANES && <SequenceDiagram sequence={sequence} />}
      <ol className="scenario-steps">
        {sequence.arrows.map((arrow) => (
          <li key={arrow.step}>
            <span className="muted">
              {sequence.lanes[arrow.from]!.label}
              {arrow.from !== arrow.to && ` → ${sequence.lanes[arrow.to]!.label}`}
              {arrow.call && `（${arrow.call}）`}
            </span>
            <div>{arrow.action}</div>
            {chips(arrow.evidence)}
          </li>
        ))}
      </ol>
    </div>
  )
}

const LANE_WIDTH = 150

function SequenceDiagram({ sequence }: { sequence: ReturnType<typeof sequenceOf> }) {
  const center = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2
  return (
    <div className="sequence" style={{ width: sequence.lanes.length * LANE_WIDTH }}>
      <div className="sequence-lanes">
        {sequence.lanes.map((lane) => (
          <div key={lane.id} className={`sequence-lane ${lane.external ? 'external' : ''}`} style={{ width: LANE_WIDTH }} title={lane.external ? '協働するモジュール' : undefined}>
            {lane.label}
          </div>
        ))}
      </div>
      <div className="sequence-body">
        {sequence.lanes.map((lane, i) => (
          <div key={lane.id} className="sequence-lifeline" style={{ left: center(i) }} />
        ))}
        {sequence.arrows.map((arrow) => {
          const left = Math.min(center(arrow.from), center(arrow.to))
          const width = Math.abs(center(arrow.to) - center(arrow.from))
          const self = arrow.from === arrow.to
          return (
            <div key={arrow.step} className="sequence-row">
              <div
                className={`sequence-arrow ${self ? 'self' : arrow.to > arrow.from ? 'right' : 'left'}`}
                style={self ? { left: center(arrow.from) } : { left, width }}
              />
              <div className="sequence-label" style={{ left: self ? center(arrow.from) + 8 : left + 6, maxWidth: self ? LANE_WIDTH - 12 : Math.max(width - 12, LANE_WIDTH - 12) }} title={arrow.action}>
                {arrow.step}. {arrow.call ?? arrow.action}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Collaborators({ index, result, brief, chips, onShowInGraph }: ModulePageProps & { result: ModuleBriefResult; brief: ModuleBrief; chips: Chips }) {
  const column = (direction: 'uses' | 'usedBy') => (
    <div className="collaborator-column">
      <h4>{direction === 'uses' ? 'このモジュールが使う' : 'このモジュールを使う'}</h4>
      <ul className="collaborator-list">
        {result.collaborators
          .filter((collaborator) => collaborator.direction === direction)
          .map((collaborator) => {
            const described = brief.collaborators.find((item) => item.moduleId === collaborator.moduleId && item.direction === direction)
            return (
              <li key={collaborator.moduleId}>
                <div>
                  <button className="link-button" onClick={() => onShowInGraph(collaborator.moduleId)} title="グラフで表示">
                    {index.hasNode(collaborator.moduleId) ? index.node(collaborator.moduleId).name : collaborator.name}
                  </button>
                  <span className="badge provenance-observed" title="コードから観測した関係の数">
                    関係 {collaborator.totalRelations}
                  </span>
                </div>
                {described ? (
                  <div>
                    <span className="badge provenance-inferred">AI の推測</span> {described.meaning}
                    {chips(described.evidence)}
                  </div>
                ) : (
                  <div className="muted">関係の意味は要約に含まれていません。</div>
                )}
              </li>
            )
          })}
      </ul>
    </div>
  )
  return (
    <div className="collaborators">
      {column('uses')}
      {column('usedBy')}
    </div>
  )
}

function Implementation({ index, moduleId, brief, result, codeRef, onShowCode }: ModulePageProps & { brief: ModuleBrief; result: ModuleBriefResult }) {
  const { groups, unclassified } = typesByResponsibility(index, moduleId, brief)
  const codeAnchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (codeRef) codeAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [codeRef])
  const typeChips = (ids: string[]) => (
    <div className="chip-row">
      {ids.map((id) => (
        <button key={id} className={`chip ${codeRef === id ? 'active' : ''}`} onClick={() => onShowCode(id)}>
          {index.node(id).name}
        </button>
      ))}
    </div>
  )
  return (
    <>
      {groups
        .filter((group) => group.typeIds.length > 0)
        .map((group) => (
          <div key={group.title} className="type-group">
            <h4>{group.title}</h4>
            {typeChips(group.typeIds)}
          </div>
        ))}
      {unclassified.length > 0 && (
        <div className="type-group">
          <h4>どの責務にも挙がっていない型</h4>
          {typeChips(unclassified)}
        </div>
      )}
      <div ref={codeAnchor}>{codeRef && <CodeOf index={index} moduleId={moduleId} refId={codeRef} result={result} />}</div>
    </>
  )
}

/** Shows the lines behind a cited declaration; for a relation, the end inside the module. */
function CodeOf({ index, moduleId, refId, result }: { index: GraphIndex; moduleId: string; refId: string; result: ModuleBriefResult }) {
  let nodeId = refId
  let note: string | null = null
  if (index.hasEdge(refId)) {
    const edge = index.edge(refId)
    nodeId = index.isWithin(edge.source, moduleId) ? edge.source : edge.target
    note = `${qualifiedName(index, edge.source)} → ${qualifiedName(index, edge.target)}（${edge.evidence.text}${edge.evidence.source ? ` · ${edge.evidence.source}` : ''}）`
  }
  if (!index.hasNode(nodeId)) return null
  const node = index.node(nodeId)
  const excerpts = (node.spans ?? []).flatMap((span) => {
    const file = result.files.find((candidate) => candidate.path === span.path)
    if (!file) return []
    const lines = file.text.split('\n').slice(span.startLine - file.startLine, span.endLine - file.startLine + 1)
    return [{ path: span.path, startLine: span.startLine, lines }]
  })
  if (excerpts.length === 0 && node.code) excerpts.push({ path: node.code.path, startLine: node.code.startLine, lines: node.code.text.split('\n') })
  return (
    <div className="module-code">
      <h4>{qualifiedName(index, nodeId)}</h4>
      {note && <p className="muted">{note}</p>}
      {excerpts.length === 0 && (
        <p className="muted">{index.isWithin(nodeId, moduleId) ? 'この要素には行範囲がありません。' : 'このモジュールの外のコードなので、ここには表示できません。'}</p>
      )}
      {excerpts.map((excerpt) => (
        <div key={`${excerpt.path}:${excerpt.startLine}`}>
          <div className="muted path">
            {excerpt.path}:{excerpt.startLine}
          </div>
          <pre>
            {excerpt.lines.map((line, i) => `${String(excerpt.startLine + i).padStart(4)}  ${line}`).join('\n')}
          </pre>
        </div>
      ))}
    </div>
  )
}

function EvidenceChips({ index, ids, emphasized, onShow }: { index: GraphIndex; ids: string[]; emphasized: ReadonlySet<string>; onShow: (id: string) => void }) {
  return (
    <span className="evidence-chips">
      {ids.map((id) => (
        <button key={id} className={`evidence-chip ${emphasized.has(id) ? 'emphasized' : ''}`} onClick={() => onShow(id)} title="根拠のコードを表示">
          {evidenceLabel(index, id)}
        </button>
      ))}
    </span>
  )
}

function evidenceLabel(index: GraphIndex, id: string): string {
  if (index.hasNode(id)) return qualifiedName(index, id)
  if (index.hasEdge(id)) {
    const edge = index.edge(id)
    return `${qualifiedName(index, edge.source)} → ${qualifiedName(index, edge.target)}`
  }
  return id
}
