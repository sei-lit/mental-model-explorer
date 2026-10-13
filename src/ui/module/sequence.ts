import type { GraphIndex } from '../../core/model/graphIndex'
import type { ModuleBrief } from '../../core/understanding/moduleBrief'

export interface Lane {
  id: string
  label: string
  /** A collaborating module rather than a type of the module being explained. */
  external: boolean
}

export interface Arrow {
  step: number
  from: number
  to: number
  /** The members the step goes between, when it names members rather than whole types. */
  call: string | null
  action: string
  evidence: string[]
}

export interface Sequence {
  lanes: Lane[]
  arrows: Arrow[]
}

/** More lanes than this no longer fit side by side; the page lists the steps instead. */
export const MAX_SEQUENCE_LANES = 6

/**
 * Lanes are types, not members: a lane per method would put a method and its own type side by side,
 * mixing levels of abstraction. Members show up on the arrow instead. Collaborating modules get one
 * lane each and are marked external, so the module's boundary stays visible.
 */
export function sequenceOf(index: GraphIndex, moduleId: string, steps: ModuleBrief['scenarios'][number]['steps']): Sequence {
  const lanes: Lane[] = []
  const laneIndex = (id: string) => {
    const lane = laneFor(index, moduleId, id)
    const found = lanes.findIndex((existing) => existing.id === lane.id)
    if (found >= 0) return found
    lanes.push(lane)
    return lanes.length - 1
  }
  const arrows = steps.map((step, i) => ({
    step: i + 1,
    from: laneIndex(step.from),
    to: laneIndex(step.to),
    call: callLabel(index, step.from, step.to),
    action: step.action,
    evidence: step.evidence,
  }))
  return { lanes, arrows }
}

function laneFor(index: GraphIndex, moduleId: string, id: string): Lane {
  if (!index.isWithin(id, moduleId) || id === moduleId) return { id, label: index.node(id).name, external: id !== moduleId }
  const type = index.path(id).find((node) => node.kind === 'type' && index.isWithin(node.id, moduleId))
  const lane = type ?? index.node(id)
  return { id: lane.id, label: lane.name, external: false }
}

function callLabel(index: GraphIndex, from: string, to: string): string | null {
  const member = (id: string) => {
    const kind = index.node(id).kind
    return kind === 'method' || kind === 'property' ? index.node(id).name : null
  }
  const [a, b] = [member(from), member(to)]
  if (a && b) return a === b ? a : `${a} → ${b}`
  return a ?? b
}
