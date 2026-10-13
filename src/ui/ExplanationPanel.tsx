import { useEffect, useRef } from 'react'
import type { AskResult } from '../core/understanding/responder'
import type { GraphIndex } from '../core/model/graphIndex'
import { perspectiveLabel } from './labels'
import type { AnswerCard } from './understandingState'

interface ExplanationPanelProps {
  index: GraphIndex
  cards: AnswerCard[]
  activeCardId: string | null
  whatIfCardId: string | null
  onActivate: (id: string | null) => void
  onRestore: (card: AnswerCard) => void
  onRetry: (card: AnswerCard) => void
  onFocusRef: (ref: string) => void
  onFollowUp: (question: string, focusRef: string | null) => void
  onHover: (refs: string[] | null) => void
  onShowWhatIf: (id: string) => void
  onHideWhatIf: () => void
}

export function ExplanationPanel(props: ExplanationPanelProps) {
  const { cards, activeCardId, onActivate } = props
  const panel = useRef<HTMLElement>(null)
  // Newest cards are listed first; bring a just-asked question into view even if the user had scrolled down.
  useEffect(() => {
    panel.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [cards.length])
  return (
    <section className="explanation panel" ref={panel}>
      <div className="panel-title">
        <h3>説明</h3>
        {activeCardId && (
          <button className="link-button" onClick={() => onActivate(null)}>
            ハイライトを消す
          </button>
        )}
      </div>
      {cards.length === 0 && <p className="muted">図の要素を選んで質問すると、答えがここに並び、対応する部分が図の上で光ります。</p>}
      {cards.map((card) => (
        <Card key={card.id} card={card} active={card.id === activeCardId} {...props} />
      ))}
    </section>
  )
}

function Card({ card, active, index, whatIfCardId, onActivate, onRestore, onRetry, onFocusRef, onFollowUp, onHover, onShowWhatIf, onHideWhatIf }: ExplanationPanelProps & { card: AnswerCard; active: boolean }) {
  const scopePath = index.path(card.viewpoint.scopeId).map((node) => node.name).join(' › ')
  return (
    <article className={active ? 'answer-card active' : 'answer-card'} onClick={() => !active && onActivate(card.id)}>
      <header>
        <div className="question">{card.question}</div>
        <div className="asked-at muted">
          質問時の視点: {scopePath} · {perspectiveLabel[card.viewpoint.perspective]} · {card.targetLabel}
        </div>
        <div className="card-actions">
          <button
            className="link-button"
            onClick={(event) => {
              event.stopPropagation()
              onRestore(card)
            }}
          >
            この時の画面に戻る
          </button>
          {card.reply.status === 'done' && <span className="muted">{card.reply.result.source === 'claude-cli' ? 'claude CLI' : 'モック'} の回答</span>}
        </div>
      </header>
      {card.reply.status === 'pending' && <p className="pending">考えています…</p>}
      {card.reply.status === 'error' && (
        <div className="error-box">
          <p>{card.reply.error}</p>
          <button
            onClick={(event) => {
              event.stopPropagation()
              onRetry(card)
            }}
          >
            もう一度試す
          </button>
        </div>
      )}
      {card.reply.status === 'done' && (
        <AnswerBody
          card={card}
          result={card.reply.result}
          index={index}
          whatIfShown={whatIfCardId === card.id}
          onFocusRef={onFocusRef}
          onFollowUp={onFollowUp}
          onHover={onHover}
          onShowWhatIf={onShowWhatIf}
          onHideWhatIf={onHideWhatIf}
        />
      )}
    </article>
  )
}

interface AnswerBodyProps {
  card: AnswerCard
  result: AskResult
  index: GraphIndex
  whatIfShown: boolean
  onFocusRef: (ref: string) => void
  onFollowUp: (question: string, focusRef: string | null) => void
  onHover: (refs: string[] | null) => void
  onShowWhatIf: (id: string) => void
  onHideWhatIf: () => void
}

function AnswerBody({ card, result, index, whatIfShown, onFocusRef, onFollowUp, onHover, onShowWhatIf, onHideWhatIf }: AnswerBodyProps) {
  const { answer, issues } = result
  return (
    <div className="answer-body">
      <p className="summary">{answer.summary}</p>
      <ul className="segments">
        {answer.segments.map((segment, i) => (
          <li key={i} onMouseEnter={() => onHover(segment.refs)} onMouseLeave={() => onHover(null)}>
            <span>{segment.text}</span>
            <span className="chip-row">
              {segment.refs.map((ref) => (
                <button
                  key={ref}
                  className="chip"
                  onClick={(event) => {
                    event.stopPropagation()
                    onFocusRef(ref)
                  }}
                >
                  {refLabel(index, ref)}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {answer.visuals.map((visual, i) => (
        <div key={i} className="visual-control">
          {visual.type === 'whatIfRemove' ? (
            <button
              onClick={(event) => {
                event.stopPropagation()
                if (whatIfShown) onHideWhatIf()
                else onShowWhatIf(card.id)
              }}
            >
              {whatIfShown ? '削除した場合の表示を閉じる' : '削除した場合を見る'}
            </button>
          ) : (
            <span className="muted">経路: {visual.label}（図に番号で表示）</span>
          )}
        </div>
      ))}
      {answer.followUps.length > 0 && (
        <div className="follow-ups">
          {answer.followUps.map((followUp, i) => (
            <button key={i} className="suggestion" onClick={(event) => {
              event.stopPropagation()
              onFollowUp(followUp.question, followUp.focusRef)
            }}>
              {followUp.question}
            </button>
          ))}
        </div>
      )}
      {issues.length > 0 && (
        <details className="issues">
          <summary>AI が存在しない要素を参照したため {issues.length} 件を除外しました</summary>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.kind === 'unknownRef'
                  ? `${issue.where === 'segment' ? '説明' : issue.where === 'highlight' ? 'ハイライト' : '次の質問'}: ${issue.ref}`
                  : `図の表現（${issue.visual === 'trace' ? '経路' : '削除の影響'}）を破棄: ${issue.unknownRefs.join(', ') || '空の指定'}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export function refLabel(index: GraphIndex, ref: string): string {
  if (index.hasNode(ref)) return index.node(ref).name
  const edge = index.edge(ref)
  return `${index.node(edge.source).name} → ${index.node(edge.target).name}`
}
