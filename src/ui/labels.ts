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
  namespace: '名前空間',
  property: 'プロパティ',
  method: 'メソッド',
} as const

const flavorLabel = { class: 'class', struct: 'struct', protocol: 'protocol', interface: 'interface', object: 'object', enum: 'enum' } as const

const flavorIcon = { class: 'C', struct: 'S', protocol: 'P', interface: 'I', object: 'O', enum: 'E' } as const

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
    case 'namespace':
      return '▢'
    case 'method':
      return 'ƒ'
    case 'property':
      return '·'
    case 'type':
      return node.flavor ? flavorIcon[node.flavor] : 'C'
  }
}

const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'

export function stepMark(step: number): string {
  return step >= 1 && step <= circled.length ? circled[step - 1]! : `(${step})`
}

export const provenanceLabel: Record<Claim['provenance'], string> = { observed: '観測', inferred: '推測' }
