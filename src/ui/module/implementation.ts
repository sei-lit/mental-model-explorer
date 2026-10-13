import type { GraphIndex } from '../../core/model/graphIndex'
import type { ModuleBrief } from '../../core/understanding/moduleBrief'

export interface TypeGroup {
  title: string
  typeIds: string[]
}

/**
 * Groups the module's types under the responsibilities whose evidence points into them. Types no
 * responsibility cites are listed separately instead of being forced into a group the AI never named.
 */
export function typesByResponsibility(index: GraphIndex, moduleId: string, brief: ModuleBrief): { groups: TypeGroup[]; unclassified: string[] } {
  const types = typesWithin(index, moduleId)
  const classified = new Set<string>()
  const groups = brief.responsibilities.map((responsibility) => {
    const typeIds = types.filter((typeId) => responsibility.evidence.some((id) => index.hasNode(id) && index.isWithin(id, typeId)))
    typeIds.forEach((id) => classified.add(id))
    return { title: responsibility.title, typeIds }
  })
  return { groups, unclassified: types.filter((id) => !classified.has(id)) }
}

function typesWithin(index: GraphIndex, id: string): string[] {
  return index.children(id).flatMap((child) => (child.kind === 'type' ? [child.id] : child.kind === 'namespace' ? typesWithin(index, child.id) : []))
}
