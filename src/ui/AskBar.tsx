import { useState } from 'react'
import type { QuestionContext } from '../core/understanding/context'
import type { ModuleBriefResult } from '../core/understanding/moduleBrief'

interface AskBarProps {
  targetLabel: string
  canSwitchTarget: boolean
  wholeViewOverride: boolean
  onToggleWholeView: () => void
  question: string
  onQuestionChange: (question: string) => void
  onSubmit: () => void
  context: QuestionContext
  onPreviewChange: (previewing: boolean) => void
  /** On a module page the bar sits above the page, where the user starts reading. */
  docked: 'top' | 'bottom'
  blockedReason: string | null
  /** The module brief the server will attach; shown so the preview covers everything sent. */
  moduleAttachment: ModuleBriefResult | null
}

export function AskBar({
  targetLabel,
  canSwitchTarget,
  wholeViewOverride,
  onToggleWholeView,
  question,
  onQuestionChange,
  onSubmit,
  context,
  onPreviewChange,
  docked,
  blockedReason,
  moduleAttachment,
}: AskBarProps) {
  const canSubmit = question.trim() !== '' && blockedReason === null
  const [previewOpen, setPreviewOpen] = useState(false)
  // The preview is for checking what will be sent; once sent, it would only cover the canvas
  // where the answer is about to be highlighted.
  const send = () => {
    setPreviewOpen(false)
    onSubmit()
  }
  return (
    <div className={`ask-bar docked-${docked}`}>
      <div className="ask-row">
        <span className="target-chip" title="質問の対象">
          対象: {targetLabel}
        </span>
        {canSwitchTarget && (
          <button className="link-button" onClick={onToggleWholeView}>
            {wholeViewOverride ? '選択中の対象に戻す' : '画面全体について聞く'}
          </button>
        )}
      </div>
      <div className="ask-row">
        <input
          className="ask-input"
          value={question}
          placeholder={blockedReason ?? '見ているものについて質問する'}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && canSubmit) send()
          }}
        />
        <button className="primary" disabled={!canSubmit} onClick={send}>
          質問
        </button>
      </div>
      <details className="context-preview" open={previewOpen} onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
        <summary onMouseEnter={() => onPreviewChange(true)} onMouseLeave={() => onPreviewChange(false)}>
          AI に渡す内容
        </summary>
        <ContextSummary context={context} />
        {moduleAttachment && <ModuleAttachmentSummary attachment={moduleAttachment} />}
        <pre>{JSON.stringify(context, null, 2)}</pre>
      </details>
    </div>
  )
}

function ContextSummary({ context }: { context: QuestionContext }) {
  const omitted = [
    ['表示要素', context.omitted.visibleNodes],
    ['表示中の関係', context.omitted.visibleEdges],
    ['周辺の関係', context.omitted.nearbyRelations],
    ['操作履歴', context.omitted.trailSteps],
    ['集約された関係の例', context.omitted.aggregatedExamples],
    ['依存している要素', context.omitted.usedBy],
    ['変更された宣言', context.omitted.changedNodes],
    ['変更されたファイル', context.omitted.changedFiles],
  ].filter(([, count]) => (count as number) > 0)

  return (
    <dl className="context-summary">
      <dt>見ているもの</dt>
      <dd>{context.lens.showing}</dd>
      <dt>視点</dt>
      <dd>{context.lens.perspectiveMeaning}</dd>
      <dt>対象</dt>
      <dd>{context.target.label}</dd>
      <dt>画面内の要素</dt>
      <dd>
        ノード {context.visible.nodes.length} 件 / 関係 {context.visible.edges.length} 件
      </dd>
      {context.changes && (
        <>
          <dt>PR</dt>
          <dd>
            {context.changes.title}（この範囲の変更 {context.changes.inScope.length + context.omitted.changedNodes} 件 / 範囲外 {context.changes.outsideScope} 件）
          </dd>
        </>
      )}
      <dt>周辺の関係</dt>
      <dd>{context.nearby.length} 件</dd>
      <dt>直近の操作</dt>
      <dd>
        {context.trail.length === 0 ? 'なし' : (
          <ol>
            {context.trail.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        )}
      </dd>
      <dt>省略した件数</dt>
      <dd>{omitted.length === 0 ? 'なし' : omitted.map(([label, count]) => `${label} ${count} 件`).join(' / ')}</dd>
    </dl>
  )
}

function ModuleAttachmentSummary({ attachment }: { attachment: ModuleBriefResult }) {
  const { manifest } = attachment
  const lines = manifest.files.reduce((sum, file) => sum + file.lines, 0)
  return (
    <div className="module-attachment">
      <p>
        ＋ サーバーが付けるモジュールの資料: ページの要約（{attachment.hash}・{attachment.generatedBy === 'mock' ? 'モック' : attachment.model}）、宣言{' '}
        {manifest.declarations} 件、協働するモジュール {manifest.collaborators} 件、ソース {manifest.files.length} ファイル（{lines} 行）
      </p>
      <details>
        <summary>ファイルの一覧</summary>
        <ul>
          {manifest.files.map((file) => (
            <li key={file.path}>
              {file.path}（{file.lines} 行）
            </li>
          ))}
          {manifest.excluded.map((file) => (
            <li key={file.path} className="muted">
              {file.path}（含めない: {file.reason}）
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
