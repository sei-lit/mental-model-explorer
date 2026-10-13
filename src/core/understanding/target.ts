import type { GraphIndex } from '../model/graphIndex'
import type { Selection } from '../exploration/state'

/** What a question is about. With nothing selected the question is about the whole current view. */
export type QuestionTarget = Exclude<Selection, { kind: 'none' }> | { kind: 'view' }

export function targetFromSelection(selection: Selection): QuestionTarget {
  return selection.kind === 'none' ? { kind: 'view' } : selection
}

export function describeTarget(index: GraphIndex, target: QuestionTarget): string {
  switch (target.kind) {
    case 'view':
      return '表示中の画面全体'
    case 'node':
      return `ノード「${index.node(target.nodeId).name}」`
    case 'nodes':
      return `ノード ${target.nodeIds.map((id) => `「${index.node(id).name}」`).join('')}`
    case 'edge':
      return `関係「${index.node(target.source).name} → ${index.node(target.target).name}」`
    case 'code':
      return `「${index.node(target.nodeId).name}」の ${target.lines.from}–${target.lines.to} 行目`
  }
}
