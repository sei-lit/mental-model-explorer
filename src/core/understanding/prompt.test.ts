import { describe, expect, it } from 'vitest'
import { answerJsonSchema } from './prompt'

describe('answerJsonSchema', () => {
  it('does not declare a meta-schema, which the claude CLI rejects', () => {
    expect(answerJsonSchema).not.toHaveProperty('$schema')
  })

  it('requires every answer field so the model always fills the structure the UI reads', () => {
    expect(answerJsonSchema).toMatchObject({ type: 'object', required: ['summary', 'segments', 'highlights', 'visuals', 'followUps'] })
  })
})
