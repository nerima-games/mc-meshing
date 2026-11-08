import { describe, expect, it } from './effect-test.js'
import * as FastCheck from 'fast-check'
import { Effect, Option, Result, Schema } from 'effect'
import { vi } from 'vitest'
import {
  BLOCK_IDS,
  ChunkAxis as chunkAxis,
  EffectiveBlockStateValuesSchema,
  chunkCoord,
  blockTypeOfId,
  encodeBlockState,
  type BlockId,
  type BlockType,
  type RenderKind,
  propertyOfBlockId,
} from '@nerima-games/mc-kernel'
import { AIR, blockIdsWithRenderKind } from '../src/domain/block-data'
import {
  BLOCKS_PER_CHUNK,
  CHUNK_HEIGHT,
  blockIndex,
  blockStateAt,
  type ChunkView,
} from '../src/domain/chunk-view'
import { meshChunk, meshChunkNaive, meshChunkRegion } from '../src/domain/mesh'
import { MINECRAFT_MESH_CONFIG } from '../src/domain/opacity'
import { railShapeCodeOf } from '../src/domain/rail-types'
import {
  isSpecialBlock,
  meshSpecialBlocks,
  SPECIAL_BLOCK_LOOKUP,
  type SpecialBlockQuad,
  type RailSpecialBlockQuad,
} from '../src/domain/special-mesh'
import { railRenderKindOf } from '../src/domain/special-types'

const MESH_CONFIG = Result.getOrThrow(MINECRAFT_MESH_CONFIG)
const SPECIAL_LOOKUP = Result.getOrThrow(SPECIAL_BLOCK_LOOKUP)

const firstBlockId = (renderKind: RenderKind): BlockId =>
  Option.getOrThrow(Option.fromNullishOr(
    BLOCK_IDS.find(
      (candidate) => candidate !== AIR &&
        Result.getOrThrow(propertyOfBlockId(candidate, 'renderKind')) === renderKind,
    ),
  ))

const firstBlockIdWithCollisionShape = (shape: 'pressurePlate' | 'slab'): BlockId =>
  Option.getOrThrow(Option.fromNullishOr(
    BLOCK_IDS.find(
      (candidate) => candidate !== AIR &&
        Result.getOrThrow(propertyOfBlockId(candidate, 'collisionShape')) === shape,
    ),
  ))

const firstBlockIdWithType = (blockType: BlockType): BlockId =>
  Option.getOrThrow(Option.fromNullishOr(
    BLOCK_IDS.find((candidate) => {
      const result = blockTypeOfId(candidate)
      return Result.isSuccess(result) && result.success === blockType
    }),
  ))

const CACTUS = firstBlockId('cactus')
const LILY_PAD = firstBlockId('lilyPad')
const RAIL = firstBlockId('rail')
const OPAQUE_CUBE = firstBlockId('cube')
const SLAB = firstBlockIdWithCollisionShape('slab')
const PRESSURE_PLATE = firstBlockIdWithCollisionShape('pressurePlate')
const DOOR = firstBlockIdWithType('door')
const FIXED_OPEN_DOOR = firstBlockIdWithType('door_open')
const STAIRS = firstBlockIdWithType('oak_stairs')
const REDSTONE_WIRE = firstBlockIdWithType('redstone_wire')
const REPEATER = firstBlockIdWithType('repeater')
const SNOW = firstBlockIdWithType('snow')
const LADDER = firstBlockIdWithType('ladder')
const LEVER = firstBlockIdWithType('lever')
const STONE_BUTTON = firstBlockIdWithType('stone_button')

const chunkWith = (cells: ReadonlyArray<readonly [number, number, number, number]>): ChunkView => {
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, blockId] of cells) {
    blocks[blockIndex(lx, y, lz, CHUNK_HEIGHT)] = blockId
  }
  return { coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height: CHUNK_HEIGHT, blocks }
}

const chunkWithStates = (
  cells: ReadonlyArray<readonly [number, number, number, number]>,
  stateCells: ReadonlyArray<readonly [number, number, number, number]>,
): ChunkView => {
  const chunk = chunkWith(cells)
  const blockStates = new Uint32Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz, encodedState] of stateCells) {
    blockStates[blockIndex(lx, y, lz, CHUNK_HEIGHT)] = encodedState
  }
  return { ...chunk, blockStates }
}

const encodeState = (blockId: BlockId, values: unknown): number =>
  Result.getOrThrow(encodeBlockState(blockId, values))

const vertexBounds = (quads: ReadonlyArray<{ readonly vertices: ReadonlyArray<readonly [number, number, number]> }>) => {
  const vertices = quads.flatMap((quad) => quad.vertices)
  return {
    minX: Math.min(...vertices.map(([x]) => x)),
    maxX: Math.max(...vertices.map(([x]) => x)),
    minY: Math.min(...vertices.map(([, y]) => y)),
    maxY: Math.max(...vertices.map(([, y]) => y)),
    minZ: Math.min(...vertices.map(([, , z]) => z)),
    maxZ: Math.max(...vertices.map(([, , z]) => z)),
  }
}

const quadsWithinBlock = (
  quads: ReadonlyArray<SpecialBlockQuad>,
  lx: number,
  y: number,
  lz: number,
): ReadonlyArray<SpecialBlockQuad> => quads.filter((quad) =>
  quad.vertices.every(([x, vertexY, z]) =>
    x >= lx && x <= lx + 1 && vertexY >= y && vertexY <= y + 1 && z >= lz && z <= lz + 1,
  ),
)

describe('kernel-defined special block geometry', () => {
  it.effect('derives every supported non-cube kind from mc-kernel', () =>
    Effect.sync(() => {
      expect(Result.getOrThrow(blockIdsWithRenderKind('cactus'))).toContain(CACTUS)
      expect(Result.getOrThrow(blockIdsWithRenderKind('lilyPad'))).toContain(LILY_PAD)
      expect(Result.getOrThrow(blockIdsWithRenderKind('rail'))).toContain(RAIL)
      expect(isSpecialBlock(SPECIAL_LOOKUP, CACTUS)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, LILY_PAD)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, RAIL)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, AIR)).toBe(false)
      expect(isSpecialBlock(SPECIAL_LOOKUP, OPAQUE_CUBE)).toBe(false)
      expect(isSpecialBlock(SPECIAL_LOOKUP, SLAB)).toBe(true)
      expect(isSpecialBlock(SPECIAL_LOOKUP, PRESSURE_PLATE)).toBe(true)
    }),
  )

  it.effect('selects the opened door panel side from facing and hinge for every horizontal orientation', () =>
    Effect.sync(() => {
      const facingValues = ['north', 'east', 'south', 'west'] as const
      const faceDirection = {
        north: 'zNeg',
        east: 'xPos',
        south: 'zPos',
        west: 'xNeg',
      } as const
      const hingeSide = {
        north: { left: 'west', right: 'east' },
        east: { left: 'north', right: 'south' },
        south: { left: 'east', right: 'west' },
        west: { left: 'south', right: 'north' },
      } as const

      FastCheck.assert(FastCheck.property(
        FastCheck.constantFrom(...facingValues),
        FastCheck.constantFrom('left' as const, 'right' as const),
        FastCheck.boolean(),
        (facing, hinge, open) => {
          const encodedState = encodeState(DOOR, { facing, hinge, open, half: 'lower' })
          const quads = Result.getOrThrow(meshSpecialBlocks(
            SPECIAL_LOOKUP,
            chunkWithStates([[8, 64, 8, DOOR]], [[8, 64, 8, encodedState]]),
            {},
            CHUNK_HEIGHT,
          ))
          const expectedFace = open ? hingeSide[facing][hinge] : facing
          const expectedBoundary = expectedFace === 'north'
            ? { axis: 2, value: 8 }
            : expectedFace === 'south'
              ? { axis: 2, value: 9 }
              : expectedFace === 'west'
                ? { axis: 0, value: 8 }
                : { axis: 0, value: 9 }
          const panelFace = quads.find((quad) => quad.direction === faceDirection[expectedFace])

          expect(panelFace).toBeDefined()
          expect(panelFace?.vertices.every((vertex) => vertex[expectedBoundary.axis] === expectedBoundary.value)).toBe(true)
          expect(vertexBounds(quads)).toMatchObject(expectedFace === 'north' || expectedFace === 'south'
            ? { minZ: expectedFace === 'north' ? 8 : 9 - 3 / 16, maxZ: expectedFace === 'north' ? 8 + 3 / 16 : 9 }
            : { minX: expectedFace === 'west' ? 8 : 9 - 3 / 16, maxX: expectedFace === 'west' ? 8 + 3 / 16 : 9 })
        },
      ))
    }),
  )

  it.effect('uses state defaults through meshChunk and preserves the effective state schema', () =>
    Effect.sync(() => {
      const layers = Result.getOrThrow(meshChunk(chunkWith([
        [1, 64, 1, DOOR],
        [3, 64, 1, FIXED_OPEN_DOOR],
        [5, 64, 1, STAIRS],
        [7, 64, 1, SLAB],
        [9, 64, 1, SNOW],
        [11, 64, 1, LADDER],
        [13, 64, 1, LEVER],
        [2, 67, 2, STONE_BUTTON],
        [4, 67, 2, REDSTONE_WIRE],
        [6, 67, 2, REPEATER],
        [8, 67, 2, RAIL],
      ]), {}, MESH_CONFIG))

      const kinds = new Set(layers.specialBlocks.map((quad) => quad.kind))
      for (const kind of ['door', 'stairs', 'slab', 'snowLayer', 'ladder', 'lever', 'stoneButton', 'redstoneWire', 'repeater', 'rail'] as const) {
        expect(kinds.has(kind)).toBe(true)
      }
      expect(layers.opaque).toHaveLength(0)

      for (const quad of layers.specialBlocks) {
        if (quad.kind === 'lilyPad' || quad.kind === 'cactus') {
          continue
        }
        expect(quad.blockState).toBeDefined()
        Schema.decodeUnknownSync(EffectiveBlockStateValuesSchema)(quad.blockState)
      }
      const closedDoor = layers.specialBlocks.find((quad) => quad.kind === 'door' && quad.blockId === DOOR)
      const fixedOpenDoor = layers.specialBlocks.find((quad) => quad.kind === 'door' && quad.blockId === FIXED_OPEN_DOOR)
      expect(closedDoor?.blockState).toMatchObject({ facing: 'north', half: 'lower', hinge: 'left', open: false })
      expect(fixedOpenDoor?.blockState).toMatchObject({ hinge: 'left', open: true })
    }),
  )

  it.effect('meshes stair half and shape boundaries and all slab vertical placements', () =>
    Effect.sync(() => {
      const bottomStairState = encodeState(STAIRS, { facing: 'north', half: 'bottom', shape: 'straight' })
      const topStairState = encodeState(STAIRS, { facing: 'east', half: 'top', shape: 'outer_right' })
      const layers = Result.getOrThrow(meshChunk(
        chunkWithStates(
          [
            [1, 64, 1, SLAB],
            [3, 64, 1, SLAB],
            [5, 64, 1, SLAB],
            [7, 64, 1, STAIRS],
            [10, 64, 1, STAIRS],
            [12, 64, 1, PRESSURE_PLATE],
            [14, 64, 1, PRESSURE_PLATE],
          ],
          [
            [1, 64, 1, encodeState(SLAB, { type: 'bottom' })],
            [3, 64, 1, encodeState(SLAB, { type: 'top' })],
            [5, 64, 1, encodeState(SLAB, { type: 'double' })],
            [7, 64, 1, bottomStairState],
            [10, 64, 1, topStairState],
            [12, 64, 1, encodeState(PRESSURE_PLATE, { powered: false })],
            [14, 64, 1, encodeState(PRESSURE_PLATE, { powered: true })],
          ],
        ),
        {},
        MESH_CONFIG,
      ))

      const slabQuads = layers.specialBlocks.filter((quad) => quad.kind === 'slab')
      expect(vertexBounds(quadsWithinBlock(slabQuads, 1, 64, 1))).toMatchObject({ minY: 64, maxY: 64.5 })
      expect(vertexBounds(quadsWithinBlock(slabQuads, 3, 64, 1))).toMatchObject({ minY: 64.5, maxY: 65 })
      expect(vertexBounds(quadsWithinBlock(slabQuads, 5, 64, 1))).toMatchObject({ minY: 64, maxY: 65 })

      const stairQuads = layers.specialBlocks.filter((quad) => quad.kind === 'stairs')
      const bottomStair = quadsWithinBlock(stairQuads, 7, 64, 1)
      const topStair = quadsWithinBlock(stairQuads, 10, 64, 1)
      expect(vertexBounds(bottomStair)).toMatchObject({ minY: 64, maxY: 65 })
      expect(bottomStair.filter((quad) => quad.direction === 'yPos' && vertexBounds([quad]).minY === 65)).toHaveLength(2)
      expect(vertexBounds(topStair)).toMatchObject({ minY: 64, maxY: 65 })
      expect(topStair.every((quad) => quad.blockState?.half === 'top')).toBe(true)
      const plateQuads = layers.specialBlocks.filter((quad) => quad.kind === 'pressurePlate')
      expect(vertexBounds(quadsWithinBlock(plateQuads, 12, 64, 1)).maxY).toBe(64 + 1 / 16)
      expect(vertexBounds(quadsWithinBlock(plateQuads, 14, 64, 1)).maxY).toBe(64 + 1 / 32)
    }),
  )

  it.effect('prefers rail blockstate shape over the legacy shape sidecar', () =>
    Effect.sync(() => {
      const railShapes = new Uint8Array(BLOCKS_PER_CHUNK)
      railShapes[blockIndex(8, 64, 8, CHUNK_HEIGHT)] = railShapeCodeOf('ascending_east')
      const encodedState = encodeState(RAIL, { shape: 'east_west' })
      const layers = Result.getOrThrow(meshChunk(
        { ...chunkWithStates([[8, 64, 8, RAIL]], [[8, 64, 8, encodedState]]), railShapes },
        {},
        MESH_CONFIG,
      ))
      const railQuads = layers.specialBlocks.filter((quad) => quad.kind === 'rail')
      expect(railQuads.every((quad) => !Object.hasOwn(quad, 'railShape'))).toBe(true)
      expect(railQuads.every((quad) => quad.blockState?.shape === 'east_west')).toBe(true)
    }),
  )

  it.effect('uses wire connections, repeater selectors, and attachment states in special geometry', () =>
    Effect.sync(() => {
      const wireState = encodeState(REDSTONE_WIRE, {
        connections: { north: 'side', east: 'up', south: 'none', west: 'side' },
        power: 13,
      })
      const repeaterState = encodeState(REPEATER, {
        facing: 'east',
        delay: 4,
        locked: true,
        powered: true,
      })
      const snowState = encodeState(SNOW, { layers: 5 })
      const ladderState = encodeState(LADDER, { facing: 'west' })
      const buttonState = encodeState(STONE_BUTTON, { facing: 'south', face: 'wall', powered: true })
      const leverState = encodeState(LEVER, { facing: 'north', face: 'ceiling', powered: true })
      const layers = Result.getOrThrow(meshChunk(
        chunkWithStates(
          [
            [1, 64, 1, REDSTONE_WIRE],
            [4, 64, 1, REPEATER],
            [7, 64, 1, SNOW],
            [10, 64, 1, LADDER],
            [13, 64, 1, STONE_BUTTON],
            [2, 67, 1, LEVER],
          ],
          [
            [1, 64, 1, wireState],
            [4, 64, 1, repeaterState],
            [7, 64, 1, snowState],
            [10, 64, 1, ladderState],
            [13, 64, 1, buttonState],
            [2, 67, 1, leverState],
          ],
        ),
        {},
        MESH_CONFIG,
      ))

      const wireQuads = quadsWithinBlock(layers.specialBlocks.filter((quad) => quad.kind === 'redstoneWire'), 1, 64, 1)
      expect(wireQuads).toHaveLength(3)
      expect(wireQuads.every((quad) => quad.blockState?.power === 13)).toBe(true)
      const repeaterQuads = quadsWithinBlock(layers.specialBlocks.filter((quad) => quad.kind === 'repeater'), 4, 64, 1)
      expect(repeaterQuads.length).toBeGreaterThan(6)
      expect(repeaterQuads.every((quad) => quad.blockState?.facing === 'east' && quad.blockState.delay === 4 && quad.blockState.locked === true && quad.blockState.powered === true)).toBe(true)
      expect(vertexBounds(quadsWithinBlock(layers.specialBlocks.filter((quad) => quad.kind === 'snowLayer'), 7, 64, 1)).maxY).toBe(64 + 5 / 8)
      expect(vertexBounds(quadsWithinBlock(layers.specialBlocks.filter((quad) => quad.kind === 'ladder'), 10, 64, 1))).toMatchObject({ minX: 10, maxX: 10 + 1 / 16 })
      expect(vertexBounds(quadsWithinBlock(layers.specialBlocks.filter((quad) => quad.kind === 'stoneButton'), 13, 64, 1))).toMatchObject({ minZ: 2 - 1 / 16, maxZ: 2 })
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'lever').every((quad) => quad.blockState?.powered === true)).toBe(true)
    }),
  )

  it.effect('returns the chunk-view failure for malformed state codes', () =>
    Effect.sync(() => {
      const chunk = chunkWithStates([[8, 64, 8, DOOR]], [[8, 64, 8, 0xFFFFFFFF]])
      const index = blockIndex(8, 64, 8, CHUNK_HEIGHT)
      const state = blockStateAt(chunk, index)
      expect(state).toMatchObject({
        _tag: 'Failure',
        failure: {
          _tag: 'ChunkBlockStateCodecFailure',
          blockId: DOOR,
          encoded: 0xFFFFFFFF,
          index,
          reason: 'reserved-code',
        },
      })
      if (Result.isFailure(state)) {
        expect(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT)).toStrictEqual(Result.fail(state.failure))
      }
    }),
  )

  it.effect('meshes slab and pressure plate collision shapes from mc-kernel', () =>
    Effect.sync(() => {
      const layers = Result.getOrThrow(meshChunk(
        chunkWith([
          [4, 64, 4, SLAB],
          [8, 64, 8, PRESSURE_PLATE],
        ]),
        {},
        MESH_CONFIG,
      ))

      expect(layers.specialBlocks).toHaveLength(12)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'slab')).toHaveLength(6)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'pressurePlate')).toHaveLength(6)
      expect(layers.opaque).toHaveLength(0)
      expect(layers.transparentSolid).toHaveLength(0)
    }),
  )

  it.effect('keeps cactus, lily pad, and rail geometry out of cube layers', () =>
    Effect.sync(() => {
      const layers = Result.getOrThrow(meshChunk(
        chunkWith([
          [4, 64, 4, CACTUS],
          [8, 64, 8, LILY_PAD],
          [12, 64, 12, RAIL],
        ]),
        {},
        MESH_CONFIG,
      ))

      expect(layers.specialBlocks).toHaveLength(9)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'cactus')).toHaveLength(6)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'lilyPad')).toHaveLength(1)
      expect(layers.specialBlocks.filter((quad) => quad.kind === 'rail')).toHaveLength(2)
      expect(layers.crossPlants).toHaveLength(0)
      expect(layers.fluids).toHaveLength(0)
      expect(layers.opaque).toHaveLength(0)
      expect(layers.water).toHaveLength(0)
      expect(layers.transparentSolid).toHaveLength(0)
    }),
  )

  it.effect('culls shared cactus faces and hides a cactus face behind an opaque cube', () =>
    Effect.sync(() => {
      const adjacent = Result.getOrThrow(meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, CACTUS],
        ]),
        {},
        MESH_CONFIG,
      ))
      expect(adjacent.specialBlocks).toHaveLength(10)

      const blocked = Result.getOrThrow(meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, OPAQUE_CUBE],
        ]),
        {},
        MESH_CONFIG,
      ))
      expect(blocked.specialBlocks).toHaveLength(5)
      expect(blocked.specialBlocks.every((quad) => quad.kind === 'cactus')).toBe(true)
      expect(blocked.opaque.length).toBeGreaterThan(0)
    }),
  )

  it.effect('emits the lily-pad top only when it is not covered', () =>
    Effect.sync(() => {
      const open = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunkWith([[8, 64, 8, LILY_PAD]]), {}, CHUNK_HEIGHT))
      expect(open).toHaveLength(1)
      expect(open[0]).toMatchObject({ direction: 'yPos', kind: 'lilyPad', role: 'top' })
      expect(open[0]?.vertices.every(([, y]) => y === 64 + 1 / 64)).toBe(true)

      const covered = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([
          [8, 64, 8, LILY_PAD],
          [8, 65, 8, OPAQUE_CUBE],
        ]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(covered).toHaveLength(0)

      const aboveDifferentKind = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([
          [8, 64, 8, LILY_PAD],
          [8, 65, 8, RAIL],
        ]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(aboveDifferentKind).toHaveLength(3)
    }),
  )

  it.effect('emits vanilla rail model faces and carries state plus kernel rail kind', () =>
    Effect.sync(() => {
      const layers = Result.getOrThrow(meshChunk(
        chunkWith([[8, 64, 8, RAIL]]),
        {},
        MESH_CONFIG,
      ))
      const expectedRailKind = Result.getOrThrow(propertyOfBlockId(RAIL, 'railKind'))

      expect(layers.specialBlocks).toHaveLength(2)
      expect(layers.specialBlocks.every((quad) => quad.kind === 'rail')).toBe(true)
      const railQuads = layers.specialBlocks.filter(
        (quad): quad is RailSpecialBlockQuad => quad.kind === 'rail',
      )
      expect(railQuads.every((quad) => quad.railKind === expectedRailKind)).toBe(true)
      expect(new Set(railQuads.map((quad) => quad.role))).toStrictEqual(new Set(['top', 'bottom']))
      expect(new Set(railQuads.map((quad) => quad.direction))).toStrictEqual(new Set(['yPos', 'yNeg']))
      expect(new Set(layers.specialBlocks.map((quad) => quad.vertices[0]?.[2])).size).toBe(2)

      const railShapes = new Uint8Array(BLOCKS_PER_CHUNK)
      railShapes[blockIndex(8, 64, 8, CHUNK_HEIGHT)] = railShapeCodeOf('ascending_east')
      const stateful = Result.getOrThrow(meshChunk(
        { ...chunkWith([[8, 64, 8, RAIL]]), railShapes },
        {},
        MESH_CONFIG,
      ))
      const statefulRails = stateful.specialBlocks.filter(
        (quad): quad is RailSpecialBlockQuad => quad.kind === 'rail',
      )
      expect(statefulRails.every((quad) => quad.railShape === 'ascending_east')).toBe(true)
      expect(statefulRails[0]?.vertices[0]).toStrictEqual([8, 64 + 1 / 16, 8])
      expect(statefulRails[0]?.vertices[2]).toStrictEqual([9, 64 + 17 / 16, 9])
    }),
  )

  it.effect('rejects the kernel sentinel for rail render geometry', () =>
    Effect.sync(() => {
      expect(railRenderKindOf('normal')).toStrictEqual(Result.succeed('normal'))
      expect(railRenderKindOf('powered')).toStrictEqual(Result.succeed('powered'))
      expect(railRenderKindOf('none')).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MissingRailRenderKind', railKind: 'none' },
      })
    }),
  )

  it.effect('keeps special output identical between merged, naive, and regional entry points', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [2, 5, 2, CACTUS],
        [8, 64, 8, LILY_PAD],
        [12, 200, 12, RAIL],
      ])
      const merged = Result.getOrThrow(meshChunk(chunk, {}, MESH_CONFIG))
      const naive = Result.getOrThrow(meshChunkNaive(chunk, {}, MESH_CONFIG))
      const regional = Result.getOrThrow(meshChunkRegion(chunk, {}, MESH_CONFIG, {
        max: [4, 10, 4],
        min: [0, 0, 0],
      }))

      expect(merged.specialBlocks).toStrictEqual(naive.specialBlocks)
      expect(regional.layers.specialBlocks).toStrictEqual(merged.specialBlocks.slice(0, 6))
      expect(regional.ownedRegion).toStrictEqual({ max: [4, 10, 4], min: [0, 0, 0] })
    }),
  )

  it.effect('does not scan a special block above the requested ceiling', () =>
    Effect.sync(() => {
      const chunk = chunkWith([[8, CHUNK_HEIGHT - 1, 8, CACTUS]])
      expect(Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT - 1))).toHaveLength(0)
      expect(Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT))).toHaveLength(6)
    }),
  )

  it.effect('fails when the special lookup omits a block or its neighbour', () =>
    Effect.sync(() => {
      const missingOwnOpacityLookup = {
        ...SPECIAL_LOOKUP,
        opacityCodes: SPECIAL_LOOKUP.opacityCodes.slice(0, CACTUS),
      }
      expect(meshSpecialBlocks(
        missingOwnOpacityLookup,
        chunkWith([[8, 64, 8, CACTUS]]),
        {},
        CHUNK_HEIGHT,
      )).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MissingSpecialBlockLookupEntry', blockId: CACTUS },
      })

      const opacityCodes = new Uint8Array(SPECIAL_LOOKUP.opacityCodes)
      opacityCodes[OPAQUE_CUBE] = 0
      const missingNeighbourLookup = { ...SPECIAL_LOOKUP, opacityCodes }
      expect(meshSpecialBlocks(
        missingNeighbourLookup,
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, OPAQUE_CUBE],
        ]),
        {},
        CHUNK_HEIGHT,
      )).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MissingSpecialBlockLookupEntry', blockId: OPAQUE_CUBE },
      })
      expect(meshSpecialBlocks(
        missingNeighbourLookup,
        chunkWith([
          [8, 64, 8, LILY_PAD],
          [8, 65, 8, OPAQUE_CUBE],
        ]),
        {},
        CHUNK_HEIGHT,
      )).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MissingSpecialBlockLookupEntry', blockId: OPAQUE_CUBE },
      })
    }),
  )

  it.effect('returns failures for invalid rail shape data and missing rail render metadata', () =>
    Effect.sync(() => {
      const railShapes = new Uint8Array(BLOCKS_PER_CHUNK)
      railShapes[blockIndex(8, 64, 8, CHUNK_HEIGHT)] = 255
      const invalidShapeChunk = { ...chunkWith([[8, 64, 8, RAIL]]), railShapes }
      expect(meshSpecialBlocks(SPECIAL_LOOKUP, invalidShapeChunk, {}, CHUNK_HEIGHT)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'InvalidRailShapeCode', code: 255 },
      })

      const missingRailKindLookup = { ...SPECIAL_LOOKUP, railKinds: [] }
      expect(meshSpecialBlocks(
        missingRailKindLookup,
        chunkWith([[8, 64, 8, RAIL]]),
        {},
        CHUNK_HEIGHT,
      )).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MissingRailRenderKind', railKind: 'none' },
      })
    }),
  )

  it.effect('clamps special mesh regions to the chunk and vertical bounds', () =>
    Effect.sync(() => {
      const edgeBlocks = chunkWith([
        [0, 0, 0, CACTUS],
        [15, 15, 15, CACTUS],
      ])
      const specialBlocks = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        edgeBlocks,
        {},
        16,
        {
          min: [-1, -1, -1],
          max: [17, 17, 17],
        },
      ))

      expect(specialBlocks).toHaveLength(12)
      expect(specialBlocks.every((quad) => quad.vertices.every(([x, y, z]) =>
        x >= 0 && x <= 16 && y >= 0 && y <= 16 && z >= 0 && z <= 16,
      ))).toBe(true)
    }),
  )

  it.effect('meshes a special block at the top of a short chunk', () =>
    Effect.sync(() => {
      const height = 8
      const blocks = new Uint16Array(16 * height * 16)
      blocks[blockIndex(8, height - 1, 8, height)] = CACTUS

      const specialBlocks = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        { blocks, coord: chunkCoord(chunkAxis(0), chunkAxis(0)), height },
        {},
        height,
      ))

      expect(specialBlocks).toHaveLength(6)
      expect(specialBlocks.every((quad) => quad.vertices.every(([, y]) => y <= height))).toBe(true)
    }),
  )

  it('propagates kernel property failures while building the special lookup', async () => {
    const expectPropertyFailure = async (failedProperty: Parameters<typeof propertyOfBlockId>[1]) => {
      vi.resetModules()
      const failure = { _tag: 'InjectedRegistryFailure', property: failedProperty }
      vi.doMock('@nerima-games/mc-kernel', async () => {
        const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
        return {
          ...kernel,
          propertyOfBlockId: (
            blockId: Parameters<typeof propertyOfBlockId>[0],
            property: Parameters<typeof propertyOfBlockId>[1],
          ) =>
            property === failedProperty ? Result.fail(failure) : kernel.propertyOfBlockId(blockId, property),
        }
      })
      try {
        const { SPECIAL_BLOCK_LOOKUP: lookupResult } = await import('../src/domain/special-mesh.js')
        expect(lookupResult).toStrictEqual(Result.fail(failure))
      } finally {
        vi.doUnmock('@nerima-games/mc-kernel')
        vi.resetModules()
      }
    }

    await expectPropertyFailure('renderKind')
    await expectPropertyFailure('collisionShape')
    await expectPropertyFailure('opacity')
    await expectPropertyFailure('railKind')
  })

  it('propagates a missing rail render kind from the kernel lookup', async () => {
    vi.resetModules()
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      return {
        ...kernel,
        propertyOfBlockId: (
          blockId: Parameters<typeof propertyOfBlockId>[0],
          property: Parameters<typeof propertyOfBlockId>[1],
        ) => {
          if (property === 'renderKind') {
            return Result.succeed('rail')
          }
          if (property === 'railKind') {
            return Result.succeed('none')
          }
          return kernel.propertyOfBlockId(blockId, property)
        },
      }
    })
    try {
      const { SPECIAL_BLOCK_LOOKUP: lookupResult } = await import('../src/domain/special-mesh.js')
      expect(lookupResult).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'MissingRailRenderKind', railKind: 'none' },
      })
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('propagates a kernel property failure for a missing lookup entry', async () => {
    vi.resetModules()
    let failCactusRenderKind = false
    const failure = { _tag: 'InjectedMissingEntryFailure' }
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      return {
        ...kernel,
        propertyOfBlockId: (
          blockId: Parameters<typeof propertyOfBlockId>[0],
          property: Parameters<typeof propertyOfBlockId>[1],
        ) =>
          failCactusRenderKind && blockId === CACTUS && property === 'renderKind'
            ? Result.fail(failure)
            : kernel.propertyOfBlockId(blockId, property),
      }
    })
    try {
      const specialMesh = await import('../src/domain/special-mesh.js')
      const lookup = Result.getOrThrow(specialMesh.SPECIAL_BLOCK_LOOKUP)
      failCactusRenderKind = true
      const incompleteLookup = { ...lookup, opacityCodes: lookup.opacityCodes.slice(0, CACTUS) }
      expect(specialMesh.meshSpecialBlocks(
        incompleteLookup,
        chunkWith([[8, 64, 8, CACTUS]]),
        {},
        CHUNK_HEIGHT,
      )).toStrictEqual(Result.fail(failure))
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })
})
