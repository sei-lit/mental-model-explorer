import type { Emphasis, ViewOverlay, WhatIfMode } from './overlay'

interface LegendProps {
  overlay: ViewOverlay
  whatIfToggle: { mode: WhatIfMode } | null
  onWhatIfMode: (mode: WhatIfMode) => void
  onJumpToAskedScreen: () => void
}

const roleText: Partial<Record<Emphasis, string>> = {
  subject: '中心',
  affected: '影響を受ける',
  related: '関連',
  path: '経路',
  removed: '削除される',
  removeTarget: '削除対象',
  broken: '切れる関係',
  affectedDirect: '直接の影響',
  affectedTransitive: '間接の影響',
}

export function Legend({ overlay, whatIfToggle, onWhatIfMode, onJumpToAskedScreen }: LegendProps) {
  const roles = new Set<Emphasis>([...overlay.nodes.values(), ...overlay.edges.values()])
  roles.delete('hover')
  if (roles.size === 0 && overlay.offscreenRefs.length === 0 && !whatIfToggle) return null
  return (
    <div className="legend">
      {whatIfToggle && (
        <div className="legend-row">
          <strong>構造上の影響（推定）</strong>
          <span className="segmented">
            {(['before', 'after'] as const).map((mode) => (
              <button key={mode} className={whatIfToggle.mode === mode ? 'active' : ''} onClick={() => onWhatIfMode(mode)}>
                {mode === 'before' ? 'Before' : 'After'}
              </button>
            ))}
          </span>
        </div>
      )}
      {roles.size > 0 && (
        <div className="legend-row">
          {[...roles].map((role) => (
            <span key={role} className="legend-item">
              <i className={`swatch emphasis-${role}`} />
              {roleText[role]}
            </span>
          ))}
        </div>
      )}
      {overlay.offscreenRefs.length > 0 && (
        <div className="legend-row">
          <span>画面外に {overlay.offscreenRefs.length} 件</span>
          <button className="link-button" onClick={onJumpToAskedScreen}>
            質問した時の画面で見る
          </button>
        </div>
      )}
    </div>
  )
}
