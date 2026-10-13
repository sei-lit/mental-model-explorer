import type { Claim, GraphNode, LayerDefinition, RelationKind } from '../core/model/graph'
import type { Perspective } from '../core/exploration/state'
import type { GraphIndex } from '../core/model/graphIndex'

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

// Layer systems differ per project, so colors are assigned by position in the project's layer list.
const layerPalette = ['#7c5cd6', '#1c9a8a', '#d99a1c', '#d0577b', '#3f7fd9', '#6aa13a', '#a0673b', '#5b6b8c']

export function layerColor(layers: readonly LayerDefinition[], layer: LayerDefinition | null): string | null {
  if (!layer) return null
  const position = layers.findIndex((candidate) => candidate.id === layer.id)
  return layerPalette[position % layerPalette.length] ?? null
}

const kindLabel = {
  project: 'プロジェクト',
  package: 'パッケージ',
  module: 'モジュール',
  namespace: '名前空間',
  property: 'プロパティ',
  method: 'メソッド',
} as const

const flavorLabel = { class: 'class', struct: 'struct', protocol: 'protocol', interface: 'interface', object: 'object', enum: 'enum', actor: 'actor', extension: 'extension' } as const

const flavorIcon = { class: 'C', struct: 'S', protocol: 'P', interface: 'I', object: 'O', enum: 'E', actor: 'A', extension: 'X' } as const

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

/** "Type.member" for members, so a member can be told apart from another type's member of the same name. */
export function qualifiedName(index: GraphIndex, id: string): string {
  const node = index.node(id)
  const parent = node.parentId ? index.node(node.parentId) : null
  return parent?.kind === 'type' ? `${parent.name}.${node.name}` : node.name
}
