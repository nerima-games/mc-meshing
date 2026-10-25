import { Option, Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { railVerticesOf } from '../src/domain/rail-geometry'
import {
  RAIL_SHAPES,
  railShapeAt,
  railShapeCodeOf,
  railShapeOf,
} from '../src/domain/rail-types'

describe('rail blockstate geometry', () => {
  it('round-trips every vanilla rail shape through its compact code', () => {
    expect(RAIL_SHAPES).toHaveLength(10)
    for (const shape of RAIL_SHAPES) {
      expect(railShapeOf(railShapeCodeOf(shape))).toStrictEqual(Result.succeed(shape))
    }
  })

  it('reads optional sidecar states and rejects invalid compact codes', () => {
    expect(railShapeAt(Option.none(), 0)).toStrictEqual(Result.succeed(Option.none()))
    const view = new Uint8Array([railShapeCodeOf('north_east')])
    expect(railShapeAt(Option.some(view), 0)).toStrictEqual(Result.succeed(Option.some('north_east')))
    expect(railShapeAt(Option.some(view), 1)).toStrictEqual(Result.succeed(Option.none()))
    expect(railShapeOf(-1)).toMatchObject({ failure: { _tag: 'InvalidRailShapeCode', code: -1 } })
    expect(railShapeOf(1.5)).toMatchObject({ failure: { _tag: 'InvalidRailShapeCode', code: 1.5 } })
    expect(railShapeOf(RAIL_SHAPES.length)).toMatchObject({
      failure: { _tag: 'InvalidRailShapeCode', code: RAIL_SHAPES.length },
    })
  })

  it('emits flat top and bottom model faces for flat and curved states', () => {
    for (const shape of RAIL_SHAPES.filter((candidate) => !candidate.startsWith('ascending_'))) {
      expect(railVerticesOf(shape, 2, 64, 3, 'yPos')).toStrictEqual([
        [2, 64 + 1 / 16, 4],
        [3, 64 + 1 / 16, 4],
        [3, 64 + 1 / 16, 3],
        [2, 64 + 1 / 16, 3],
      ])
    }
    expect(railVerticesOf('north_south', 2, 64, 3, 'yNeg')).toStrictEqual([
      [2, 64 + 1 / 16, 3],
      [3, 64 + 1 / 16, 3],
      [3, 64 + 1 / 16, 4],
      [2, 64 + 1 / 16, 4],
    ])
  })

  it('raises north and south shapes along the matching horizontal axis', () => {
    const north = railVerticesOf('ascending_north', 0, 0, 0, 'yPos')
    const south = railVerticesOf('ascending_south', 0, 0, 0, 'yPos')

    expect(north[0]?.[1]).toBe(1 / 16)
    expect(north[2]?.[1]).toBe(17 / 16)
    expect(south[0]?.[1]).toBe(17 / 16)
    expect(south[2]?.[1]).toBe(1 / 16)
  })

  it('applies the vanilla quarter-turn convention to east and west slopes', () => {
    const east = railVerticesOf('ascending_east', 0, 0, 0, 'yPos')
    const west = railVerticesOf('ascending_west', 0, 0, 0, 'yPos')

    expect(east).toStrictEqual([
      [0, 1 / 16, 0],
      [0, 1 / 16, 1],
      [1, 17 / 16, 1],
      [1, 17 / 16, 0],
    ])
    expect(west).toStrictEqual([
      [0, 17 / 16, 0],
      [0, 17 / 16, 1],
      [1, 1 / 16, 1],
      [1, 1 / 16, 0],
    ])
  })
})
