import { describe, expect, it } from 'vitest'
import { maxLevelOf } from '../src/domain/fluid-sampling.js'

describe('maxLevelOf', () => {
  it('rejects a block id with no entry in the fluid lookup table', () => {
    const lookup = new Uint16Array([0, 8])
    expect(maxLevelOf(lookup, 1)).toBe(7)
    expect(() => maxLevelOf(lookup, 5)).toThrow('unreachable')
  })
})
