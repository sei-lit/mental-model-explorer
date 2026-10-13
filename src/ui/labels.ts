import type { Claim, GraphNode, RelationKind } from '../core/model/graph'
import type { Perspective } from '../core/exploration/state'

export const relationLabel: Record<RelationKind, string> = {
  depends_on: '依存',
  implements: '実装',
  calls: '呼び出し',
  observes: '監視',
  creates: '生成',
  passes_data: 'データ',
}

export const perspectiveLabel: Record<Perspective, string> = {
  structure: '構造',
  responsibility: '責務',
  flow: '流れ',
}

export const layerLabel = { presentation: 'Presentation', domain: 'Domain', data: 'Data' } as const

const kindLabel = {
  project: 'プロジェクト',
  package: 'パッケージ',
  module: 'モジュール',
  property: 'プロパティ',
  method: 'メソッド',
} as const

const flavorLabel = { class: 'class', struct: 'struct', protocol: 'protocol', enum: 'enum' } as const

export function kindText(node: GraphNode): string {
  if (node.kind === 'type') return node.flavor ? flavorLabel[node.flavor] : '型'
  return kindLabel[node.kind]
}

export function kindIcon(node: GraphNode): string {
  switch (node.kind) {
    case 'project':
      return '◆'
    case 'package':
      return '▣'
    case 'module':
      return '▤'
    case 'method':
      return 'ƒ'
    case 'property':
      return '·'
    case 'type':
      return node.flavor === 'protocol' ? 'P' : node.flavor === 'struct' ? 'S' : node.flavor === 'enum' ? 'E' : 'C'
  }
}

const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

export function stepMark(step: number): string {
  return step >= 1 && step <= circled.length ? circled[step - 1]! : `(${step})`
}

export const provenanceLabel: Record<Claim['provenance'], string> = { observed: '観測', inferred: '推測' }
