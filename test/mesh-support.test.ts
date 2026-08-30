import { describe, expect, it } from 'vitest'
import { layerAt } from '../src/domain/mesh-support.js'

describe('layerAt', () => {
  it('rejects a block id with no entry in the lookup table', () => {
    const lookup = new Uint8Array([0, 1, 2])
    expect(layerAt(lookup, 1)).toBe(1)
    expect(() => layerAt(lookup, 5)).toThrow('unreachable')
  })
})
