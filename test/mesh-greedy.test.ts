import { describe, expect, it } from 'vitest'
import { maskCellAt } from '../src/domain/mesh-greedy.js'

describe('maskCellAt', () => {
  it('rejects a mask index outside the mask array', () => {
    const mask = new Uint32Array([0, 5, 9])
    expect(maskCellAt(mask, 1)).toBe(5)
    expect(() => maskCellAt(mask, 3)).toThrow('unreachable')
  })
})
