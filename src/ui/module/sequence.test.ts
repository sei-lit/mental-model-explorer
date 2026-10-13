import { describe, expect, it } from 'vitest'
import { GraphIndex } from '../../core/model/graphIndex'
import { miniGraph } from '../../core/testing/miniGraph'
import { sequenceOf } from './sequence'

const index = new GraphIndex(miniGraph())
const step = (from: string, to: string, action = 'a') => ({ from, to, action, evidence: ['e'] })

describe('sequenceOf', () => {
  // miniGraph names a member after its id, so the member "load" is named "VM.load".
  it('draws one lane per type, with the members named on the arrow', () => {
    const sequence = sequenceOf(index, 'mod.Screen', [step('method.VM.load', 'type.View'), step('type.View', 'method.VM.load')])

    expect(sequence.lanes).toEqual([
      { id: 'type.VM', label: 'VM', external: false },
      { id: 'type.View', label: 'View', external: false },
    ])
    expect(sequence.arrows.map(({ from, to, call }) => ({ from, to, call }))).toEqual([
      { from: 0, to: 1, call: 'VM.load' },
      { from: 1, to: 0, call: 'VM.load' },
    ])
  })

  it('gives a collaborating module its own external lane', () => {
    const sequence = sequenceOf(index, 'mod.Screen', [step('method.VM.load', 'mod.UseCase', '一覧を取得する')])

    expect(sequence.lanes[1]).toEqual({ id: 'mod.UseCase', label: 'UseCase', external: true })
    expect(sequence.arrows[0]).toMatchObject({ step: 1, from: 0, to: 1, action: '一覧を取得する' })
  })

  it('keeps a call within one type on a single lane', () => {
    const sequence = sequenceOf(index, 'mod.Screen', [step('method.VM.load', 'type.VM')])

    expect(sequence.lanes).toHaveLength(1)
    expect(sequence.arrows[0]).toMatchObject({ from: 0, to: 0 })
  })
})
