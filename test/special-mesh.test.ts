import { describe, expect, it } from './effect-test.js'
import * as FastCheck from 'fast-check'
import { Effect, Option, Result, Schema } from 'effect'
import { vi } from 'vitest'
import {
  BLOCK_IDS,
  BlockId as KernelBlockId,
  ChunkAxis as chunkAxis,
  EffectiveBlockStateValuesSchema,
  type EffectiveBlockStateValues,
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
const invalidFixture = <T,>(value: any): T => value

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
const TORCH = firstBlockIdWithType('torch')
const REDSTONE_TORCH = firstBlockIdWithType('redstone_torch')
const REDSTONE_WALL_TORCH = firstBlockIdWithType('redstone_wall_torch')
const PISTON = firstBlockIdWithType('piston')
const STICKY_PISTON = firstBlockIdWithType('sticky_piston')
const FARMLAND = firstBlockIdWithType('farmland')
const CHEST = firstBlockIdWithType('chest')
const ENDER_CHEST = firstBlockIdWithType('ender_chest')
const BED = firstBlockIdWithType('bed')
const ANVIL = firstBlockIdWithType('anvil')
const CAULDRON = firstBlockIdWithType('cauldron')
const WATER_CAULDRON = firstBlockIdWithType('water_cauldron')
const HOPPER = firstBlockIdWithType('hopper')
const COMPARATOR = firstBlockIdWithType('comparator')
const ENCHANTING_TABLE = firstBlockIdWithType('enchanting_table')
const BREWING_STAND = firstBlockIdWithType('brewing_stand')
const END_PORTAL_FRAME = firstBlockIdWithType('end_portal_frame')
const END_PORTAL_FRAME_FILLED = firstBlockIdWithType('end_portal_frame_filled')
const END_PORTAL = firstBlockIdWithType('end_portal')
const END_GATEWAY = firstBlockIdWithType('end_gateway')
const END_CRYSTAL = firstBlockIdWithType('end_crystal')
const END_ROD = firstBlockIdWithType('end_rod')
const PISTON_HEAD = firstBlockIdWithType('piston_head')
const DRAGON_EGG = firstBlockIdWithType('dragon_egg')
const NETHER_PORTAL = firstBlockIdWithType('nether_portal')
const FIRE = firstBlockIdWithType('fire')
const WITHER_SKELETON_SKULL = firstBlockIdWithType('wither_skeleton_skull')
const CHORUS_FLOWER = firstBlockIdWithType('chorus_flower')
const CHORUS_PLANT = firstBlockIdWithType('chorus_plant')

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

const expectBoundsCloseTo = (
  actual: ReturnType<typeof vertexBounds>,
  expected: ReturnType<typeof vertexBounds>,
): void => {
  for (const key of ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'] as const) {
    expect(actual[key]).toBeCloseTo(expected[key], 5)
  }
}

type GeometryVertex = readonly [x: number, y: number, z: number]
type StairFacingValue = 'north' | 'east' | 'south' | 'west'
type StairShapeValue = 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right'
type StairHalfValue = 'bottom' | 'top'
type StairQuadrantName = 'NW' | 'NE' | 'SW' | 'SE'

const STAIR_QUADRANT_CELLS: Readonly<Record<StairQuadrantName, readonly [x: number, z: number]>> = {
  NW: [0, 0],
  NE: [1, 0],
  SW: [0, 1],
  SE: [1, 1],
}

const STAIR_UPPER_QUADRANTS: Readonly<Record<
  StairFacingValue,
  Readonly<Record<StairShapeValue, ReadonlyArray<StairQuadrantName>>>
>> = {
  north: {
    straight: ['NW', 'NE'],
    inner_left: ['NW', 'NE', 'SW'],
    inner_right: ['NW', 'NE', 'SE'],
    outer_left: ['NW'],
    outer_right: ['NE'],
  },
  east: {
    straight: ['NE', 'SE'],
    inner_left: ['NW', 'NE', 'SE'],
    inner_right: ['NE', 'SE', 'SW'],
    outer_left: ['NE'],
    outer_right: ['SE'],
  },
  south: {
    straight: ['SW', 'SE'],
    inner_left: ['NE', 'SW', 'SE'],
    inner_right: ['NW', 'SW', 'SE'],
    outer_left: ['SE'],
    outer_right: ['SW'],
  },
  west: {
    straight: ['NW', 'SW'],
    inner_left: ['NW', 'SW', 'SE'],
    inner_right: ['NW', 'NE', 'SW'],
    outer_left: ['SW'],
    outer_right: ['NW'],
  },
}

const STAIR_FACE_OFFSETS = [
  { direction: 'xNeg', delta: [-1, 0, 0] },
  { direction: 'xPos', delta: [1, 0, 0] },
  { direction: 'yNeg', delta: [0, -1, 0] },
  { direction: 'yPos', delta: [0, 1, 0] },
  { direction: 'zNeg', delta: [0, 0, -1] },
  { direction: 'zPos', delta: [0, 0, 1] },
] as const

const sortedVertexKey = (vertices: ReadonlyArray<GeometryVertex>): string =>
  vertices.map((vertex) => vertex.join(',')).sort().join(';')

const geometryFaceKey = (direction: string, vertices: ReadonlyArray<GeometryVertex>): string =>
  `${direction}|${sortedVertexKey(vertices)}`

const boxGeometryFaceKeys = (bounds: {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}): ReadonlyArray<string> => {
  const { minX, maxX, minY, maxY, minZ, maxZ } = bounds
  return [
    geometryFaceKey('xNeg', [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ]]),
    geometryFaceKey('xPos', [[maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]]),
    geometryFaceKey('yNeg', [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]]),
    geometryFaceKey('yPos', [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]]),
    geometryFaceKey('zNeg', [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]]),
    geometryFaceKey('zPos', [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]]),
  ].sort()
}

const expectedStairFaceKeys = (
  [lx, y, lz]: readonly [number, number, number],
  facing: StairFacingValue,
  half: StairHalfValue,
  shape: StairShapeValue,
): ReadonlyArray<string> => {
  const occupied = new Map<string, readonly [number, number, number]>()
  const baseLayer = half === 'bottom' ? 0 : 1
  const stepLayer = half === 'bottom' ? 1 : 0
  const code = (x: number, layer: number, z: number): string => `${x}:${layer}:${z}`
  const addCell = (x: number, layer: number, z: number): void => {
    occupied.set(code(x, layer, z), [x, layer, z])
  }

  for (const x of [0, 1]) {
    for (const z of [0, 1]) {
      addCell(x, baseLayer, z)
    }
  }
  for (const quadrant of STAIR_UPPER_QUADRANTS[facing][shape]) {
    const [x, z] = STAIR_QUADRANT_CELLS[quadrant]
    addCell(x, stepLayer, z)
  }

  const faces: Array<string> = []
  for (const [x, layer, z] of occupied.values()) {
    for (const { direction, delta } of STAIR_FACE_OFFSETS) {
      const [dx, dy, dz] = delta
      const adjacent = [x + dx, layer + dy, z + dz] as const
      const inside = adjacent.every((coordinate) => coordinate >= 0 && coordinate <= 1)
      if (inside && occupied.has(code(...adjacent))) {
        continue
      }

      const bounds = {
        minX: lx + x / 2,
        maxX: lx + (x + 1) / 2,
        minY: y + layer / 2,
        maxY: y + (layer + 1) / 2,
        minZ: lz + z / 2,
        maxZ: lz + (z + 1) / 2,
      }
      const { minX, maxX, minY, maxY, minZ, maxZ } = bounds
      const vertices: ReadonlyArray<GeometryVertex> = direction === 'xNeg'
        ? [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ]]
        : direction === 'xPos'
          ? [[maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]]
          : direction === 'yNeg'
            ? [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]]
            : direction === 'yPos'
              ? [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]]
              : direction === 'zNeg'
                ? [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]]
                : [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]]
      faces.push(geometryFaceKey(direction, vertices))
    }
  }
  return faces.sort()
}

type RailShapeValue =
  | 'north_south'
  | 'east_west'
  | 'ascending_east'
  | 'ascending_west'
  | 'ascending_north'
  | 'ascending_south'
  | 'south_east'
  | 'south_west'
  | 'north_west'
  | 'north_east'

const EXPECTED_RAIL_VERTICES: Readonly<Record<RailShapeValue, ReadonlyArray<GeometryVertex>>> = {
  north_south: [[0, 1 / 16, 0], [1, 1 / 16, 0], [1, 1 / 16, 1], [0, 1 / 16, 1]],
  east_west: [[0, 1 / 16, 0], [1, 1 / 16, 0], [1, 1 / 16, 1], [0, 1 / 16, 1]],
  ascending_east: [[0, 1 / 16, 0], [1, 17 / 16, 0], [1, 17 / 16, 1], [0, 1 / 16, 1]],
  ascending_west: [[0, 17 / 16, 0], [1, 1 / 16, 0], [1, 1 / 16, 1], [0, 17 / 16, 1]],
  ascending_north: [[0, 17 / 16, 0], [1, 17 / 16, 0], [1, 1 / 16, 1], [0, 1 / 16, 1]],
  ascending_south: [[0, 1 / 16, 0], [1, 1 / 16, 0], [1, 17 / 16, 1], [0, 17 / 16, 1]],
  south_east: [[0, 1 / 16, 0], [1, 1 / 16, 0], [1, 1 / 16, 1], [0, 1 / 16, 1]],
  south_west: [[0, 1 / 16, 0], [1, 1 / 16, 0], [1, 1 / 16, 1], [0, 1 / 16, 1]],
  north_west: [[0, 1 / 16, 0], [1, 1 / 16, 0], [1, 1 / 16, 1], [0, 1 / 16, 1]],
  north_east: [[0, 1 / 16, 0], [1, 1 / 16, 0], [1, 1 / 16, 1], [0, 1 / 16, 1]],
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

const geometryFaceKeysOnPlane = (
  quads: ReadonlyArray<SpecialBlockQuad>,
  direction: string,
  axis: 0 | 1 | 2,
  coordinate: number,
): ReadonlyArray<string> => quads
  .filter((quad) => quad.direction === direction && quad.vertices.every((vertex) => vertex[axis] === coordinate))
  .map((quad) => geometryFaceKey(quad.direction, quad.vertices))
  .sort()

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

  it.effect('meshes selected non-cube blocks within their expected model bounds', () =>
    Effect.sync(() => {
      const torchQuads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([[8, 64, 8, TORCH]]),
        {},
        CHUNK_HEIGHT,
      ))
      const torchExpected = [
        geometryFaceKey('yNeg', [[8 + 7 / 16, 64, 8 + 7 / 16], [8 + 9 / 16, 64, 8 + 7 / 16], [8 + 9 / 16, 64, 8 + 9 / 16], [8 + 7 / 16, 64, 8 + 9 / 16]]),
        geometryFaceKey('yPos', [[8 + 7 / 16, 64 + 10 / 16, 8 + 9 / 16], [8 + 9 / 16, 64 + 10 / 16, 8 + 9 / 16], [8 + 9 / 16, 64 + 10 / 16, 8 + 7 / 16], [8 + 7 / 16, 64 + 10 / 16, 8 + 7 / 16]]),
        geometryFaceKey('xNeg', [[8 + 7 / 16, 64, 8 + 7 / 16], [8 + 7 / 16, 64, 8 + 9 / 16], [8 + 7 / 16, 64 + 10 / 16, 8 + 9 / 16], [8 + 7 / 16, 64 + 10 / 16, 8 + 7 / 16]]),
        geometryFaceKey('xPos', [[8 + 9 / 16, 64, 8 + 9 / 16], [8 + 9 / 16, 64, 8 + 7 / 16], [8 + 9 / 16, 64 + 10 / 16, 8 + 7 / 16], [8 + 9 / 16, 64 + 10 / 16, 8 + 9 / 16]]),
        geometryFaceKey('zNeg', [[8 + 9 / 16, 64, 8 + 7 / 16], [8 + 7 / 16, 64, 8 + 7 / 16], [8 + 7 / 16, 64 + 10 / 16, 8 + 7 / 16], [8 + 9 / 16, 64 + 10 / 16, 8 + 7 / 16]]),
        geometryFaceKey('zPos', [[8 + 7 / 16, 64, 8 + 9 / 16], [8 + 9 / 16, 64, 8 + 9 / 16], [8 + 9 / 16, 64 + 10 / 16, 8 + 9 / 16], [8 + 7 / 16, 64 + 10 / 16, 8 + 9 / 16]]),
      ].sort()
      expect(torchQuads.map((quad) => geometryFaceKey(quad.direction, quad.vertices)).sort()).toStrictEqual(torchExpected)
      expect(vertexBounds(torchQuads)).toStrictEqual({
        minX: 8 + 7 / 16,
        maxX: 8 + 9 / 16,
        minY: 64,
        maxY: 64 + 10 / 16,
        minZ: 8 + 7 / 16,
        maxZ: 8 + 9 / 16,
      })
      expect(torchQuads.every((quad) => quad.kind === 'blockModel')).toBe(true)

      const farmlandQuads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates([[8, 64, 8, FARMLAND]], [[8, 64, 8, encodeState(FARMLAND, { moisture: 7 })]]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(vertexBounds(farmlandQuads)).toStrictEqual({
        minX: 8,
        maxX: 9,
        minY: 64,
        maxY: 64 + 15 / 16,
        minZ: 8,
        maxZ: 9,
      })

      const chestQuads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates([[8, 64, 8, CHEST]], [[8, 64, 8, encodeState(CHEST, { facing: 'north', type: 'single' })]]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(vertexBounds(chestQuads)).toStrictEqual({
        minX: 8 + 1 / 16,
        maxX: 8 + 15 / 16,
        minY: 64,
        maxY: 64 + 14 / 16,
        minZ: 8 + 1 / 16,
        maxZ: 8 + 15 / 16,
      })
      const chestLeft = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates([[8, 64, 8, CHEST]], [[8, 64, 8, encodeState(CHEST, { facing: 'north', type: 'left' })]]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(vertexBounds(chestLeft)).toStrictEqual({
        minX: 8 + 1 / 16,
        maxX: 8 + 8 / 16,
        minY: 64,
        maxY: 64 + 14 / 16,
        minZ: 8 + 1 / 16,
        maxZ: 8 + 15 / 16,
      })

      const bedQuads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates([[8, 64, 8, BED]], [[8, 64, 8, encodeState(BED, { facing: 'east', occupied: false, part: 'head' })]]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(vertexBounds(bedQuads)).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 64 + 9 / 16, minZ: 8, maxZ: 9 })

      const frame = (blockId: BlockId, facing: 'north') => Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates([[8, 64, 8, blockId]], [[8, 64, 8, encodeState(blockId, { facing })]]),
        {},
        CHUNK_HEIGHT,
      ))
      expect(vertexBounds(frame(END_PORTAL_FRAME, 'north'))).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 64 + 13 / 16, minZ: 8, maxZ: 9 })
      const filledFrame = frame(END_PORTAL_FRAME_FILLED, 'north')
      expect(vertexBounds(filledFrame)).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 9 })
      expect(vertexBounds(filledFrame.filter((quad) => quad.direction === 'yPos' && quad.vertices.every(([, y]) => y === 65))))
        .toStrictEqual({ minX: 8 + 4 / 16, maxX: 8 + 12 / 16, minY: 65, maxY: 65, minZ: 8 + 4 / 16, maxZ: 8 + 12 / 16 })
    }),
  )

  it.effect('meshes portal surfaces as planes and keeps entity-only crystal models typed', () =>
    Effect.sync(() => {
      const portalSurface = { minX: 8, maxX: 9, minY: 64 + 12 / 16, maxY: 64 + 12 / 16, minZ: 8, maxZ: 9 }
      for (const blockId of [END_PORTAL, END_GATEWAY]) {
        const quads = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunkWith([[8, 64, 8, blockId]]), {}, CHUNK_HEIGHT))
        expect(quads).toHaveLength(2)
        expect(vertexBounds(quads)).toStrictEqual(portalSurface)
        expect(quads.every((quad) => quad.kind === 'blockModel' && (quad.direction === 'yNeg' || quad.direction === 'yPos'))).toBe(true)
      }
      expect(meshSpecialBlocks(SPECIAL_LOOKUP, chunkWith([[8, 64, 8, END_CRYSTAL]]), {}, CHUNK_HEIGHT)).toStrictEqual(Result.fail({
        _tag: 'UnsupportedSpecialBlockModel',
        blockId: END_CRYSTAL,
        blockType: 'end_crystal',
      }))
    }),
  )

  it.effect('matches the vanilla retracted and extended piston base bounds', () =>
    Effect.sync(() => {
      const expectedExtendedBounds = {
        up: { minX: 8, maxX: 9, minY: 64, maxY: 64 + 12 / 16, minZ: 8, maxZ: 9 },
        down: { minX: 8, maxX: 9, minY: 64 + 4 / 16, maxY: 65, minZ: 8, maxZ: 9 },
        north: { minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8 + 4 / 16, maxZ: 9 },
        south: { minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 8 + 12 / 16 },
        west: { minX: 8 + 4 / 16, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 9 },
        east: { minX: 8, maxX: 8 + 12 / 16, minY: 64, maxY: 65, minZ: 8, maxZ: 9 },
      } as const
      const modelAt = (blockId: BlockId, state: Readonly<Record<string, unknown>>) => Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates([[8, 64, 8, blockId]], [[8, 64, 8, encodeState(blockId, state)]]),
        {},
        CHUNK_HEIGHT,
        { min: [8, 64, 8], max: [9, 65, 9] },
      ))

      for (const blockId of [PISTON, STICKY_PISTON]) {
        expect(vertexBounds(modelAt(blockId, { facing: 'north', extended: false }))).toStrictEqual({
          minX: 8,
          maxX: 9,
          minY: 64,
          maxY: 65,
          minZ: 8,
          maxZ: 9,
        })
        for (const [facing, expected] of Object.entries(expectedExtendedBounds)) {
          expect(vertexBounds(modelAt(blockId, { facing, extended: true }))).toStrictEqual(expected)
        }
      }
    }),
  )

  it.effect('returns a typed unsupported-model failure for a mismatched supplied lookup', () =>
    Effect.sync(() => {
      const kindCodes = SPECIAL_LOOKUP.kindCodes.slice()
      kindCodes[OPAQUE_CUBE] = Option.getOrThrow(Option.fromNullishOr(SPECIAL_LOOKUP.kindCodes[TORCH]))
      const mismatchedLookup = { ...SPECIAL_LOOKUP, kindCodes }
      const blockType = Result.getOrThrow(blockTypeOfId(OPAQUE_CUBE))

      expect(meshSpecialBlocks(
        mismatchedLookup,
        chunkWith([[8, 64, 8, OPAQUE_CUBE]]),
        {},
        CHUNK_HEIGHT,
      )).toStrictEqual(Result.fail({
        _tag: 'UnsupportedSpecialBlockModel',
        blockId: OPAQUE_CUBE,
        blockType,
      }))
    }),
  )

  it.effect('covers special model states and independently specified model bounds', () =>
    Effect.sync(() => {
      const modelAt = (blockId: BlockId, state?: Readonly<Record<string, unknown>>) => {
        const chunk = typeof state === 'undefined'
          ? chunkWith([[8, 64, 8, blockId]])
          : chunkWithStates([[8, 64, 8, blockId]], [[8, 64, 8, encodeState(blockId, state)]])
        const quads = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT))
        expect(quads.every((quad) => quad.kind === 'blockModel' && typeof quad.blockState !== 'undefined')).toBe(true)
        return quads
      }

      const redstoneTorch = modelAt(REDSTONE_TORCH, { lit: false })
      expect(vertexBounds(redstoneTorch)).toStrictEqual({
        minX: 8 + 6.5 / 16,
        maxX: 8 + 9.5 / 16,
        minY: 64,
        maxY: 64 + 10.5 / 16,
        minZ: 8 + 6.5 / 16,
        maxZ: 8 + 9.5 / 16,
      })
      expect(redstoneTorch.every((quad) => quad.blockState?.lit === false)).toBe(true)

      const wallTorch = modelAt(REDSTONE_WALL_TORCH, { facing: 'north', lit: true })
      expectBoundsCloseTo(vertexBounds(wallTorch), {
        minX: 8 + 6.5 / 16,
        maxX: 8 + 9.5 / 16,
        minY: 64 + 3.117317 / 16,
        maxY: 64 + 13.774760 / 16,
        minZ: 8 + 10.596005 / 16,
        maxZ: 8 + 16.923880 / 16,
      })
      expect(wallTorch.every((quad) => quad.blockState?.facing === 'north' && quad.blockState.lit === true)).toBe(true)

      const wallTorchBoundsByFacing = {
        east: { minX: 8 - 0.923880 / 16, maxX: 8 + 5.403995 / 16, minY: 64 + 3.117317 / 16, maxY: 64 + 13.774760 / 16, minZ: 8 + 6.5 / 16, maxZ: 8 + 9.5 / 16 },
        south: { minX: 8 + 6.5 / 16, maxX: 8 + 9.5 / 16, minY: 64 + 3.117317 / 16, maxY: 64 + 13.774760 / 16, minZ: 8 - 0.923880 / 16, maxZ: 8 + 5.403995 / 16 },
        west: { minX: 8 + 10.596005 / 16, maxX: 8 + 16.923880 / 16, minY: 64 + 3.117317 / 16, maxY: 64 + 13.774760 / 16, minZ: 8 + 6.5 / 16, maxZ: 8 + 9.5 / 16 },
      } as const
      for (const [facing, expected] of Object.entries(wallTorchBoundsByFacing)) {
        expectBoundsCloseTo(vertexBounds(modelAt(REDSTONE_WALL_TORCH, { facing, lit: false })), expected)
      }

      const enderChest = modelAt(ENDER_CHEST, { facing: 'south', waterlogged: false })
      expect(vertexBounds(enderChest)).toStrictEqual({
        minX: 8 + 1 / 16,
        maxX: 8 + 15 / 16,
        minY: 64,
        maxY: 64 + 14 / 16,
        minZ: 8 + 1 / 16,
        maxZ: 8 + 15 / 16,
      })

      const chestHalfCases = [
        { facing: 'north', type: 'right', minX: 8 + 8 / 16, maxX: 8 + 15 / 16, minZ: 8 + 1 / 16, maxZ: 8 + 15 / 16 },
        { facing: 'south', type: 'left', minX: 8 + 8 / 16, maxX: 8 + 15 / 16, minZ: 8 + 1 / 16, maxZ: 8 + 15 / 16 },
        { facing: 'south', type: 'right', minX: 8 + 1 / 16, maxX: 8 + 8 / 16, minZ: 8 + 1 / 16, maxZ: 8 + 15 / 16 },
        { facing: 'east', type: 'left', minX: 8 + 1 / 16, maxX: 8 + 15 / 16, minZ: 8 + 1 / 16, maxZ: 8 + 8 / 16 },
        { facing: 'east', type: 'right', minX: 8 + 1 / 16, maxX: 8 + 15 / 16, minZ: 8 + 8 / 16, maxZ: 8 + 15 / 16 },
        { facing: 'west', type: 'left', minX: 8 + 1 / 16, maxX: 8 + 15 / 16, minZ: 8 + 8 / 16, maxZ: 8 + 15 / 16 },
        { facing: 'west', type: 'right', minX: 8 + 1 / 16, maxX: 8 + 15 / 16, minZ: 8 + 1 / 16, maxZ: 8 + 8 / 16 },
      ] as const
      for (const { facing, type, minX, maxX, minZ, maxZ } of chestHalfCases) {
        expect(vertexBounds(modelAt(CHEST, { facing, type }))).toStrictEqual({
          minX,
          maxX,
          minY: 64,
          maxY: 64 + 14 / 16,
          minZ,
          maxZ,
        })
      }

      const anvilNorth = modelAt(ANVIL, { facing: 'north' })
      const anvilEast = modelAt(ANVIL, { facing: 'east' })
      expect(vertexBounds(anvilNorth)).toStrictEqual({
        minX: 8,
        maxX: 9,
        minY: 64,
        maxY: 65,
        minZ: 8 + 2 / 16,
        maxZ: 8 + 14 / 16,
      })
      expect(vertexBounds(anvilEast)).toStrictEqual({
        minX: 8 + 2 / 16,
        maxX: 8 + 14 / 16,
        minY: 64,
        maxY: 65,
        minZ: 8,
        maxZ: 9,
      })
      for (const facing of ['south', 'west'] as const) {
        const anvil = modelAt(ANVIL, { facing })
        expect(vertexBounds(anvil)).toStrictEqual(facing === 'south'
          ? { minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8 + 2 / 16, maxZ: 8 + 14 / 16 }
          : { minX: 8 + 2 / 16, maxX: 8 + 14 / 16, minY: 64, maxY: 65, minZ: 8, maxZ: 9 })
      }
      const anvilPlaneBounds = (quads: ReadonlyArray<SpecialBlockQuad>, direction: string, axis: 0 | 1 | 2, coordinate: number) =>
        vertexBounds(quads.filter((quad) => quad.direction === direction && quad.vertices.every((vertex) => vertex[axis] === coordinate)))
      expect(anvilPlaneBounds(anvilNorth, 'yNeg', 1, 64)).toStrictEqual({ minX: 8 + 2 / 16, maxX: 8 + 14 / 16, minY: 64, maxY: 64, minZ: 8 + 2 / 16, maxZ: 8 + 14 / 16 })
      expect(anvilPlaneBounds(anvilNorth, 'zNeg', 2, 8 + 4 / 16)).toStrictEqual({ minX: 8 + 3 / 16, maxX: 8 + 13 / 16, minY: 64 + 4 / 16, maxY: 64 + 5 / 16, minZ: 8 + 4 / 16, maxZ: 8 + 4 / 16 })
      expect(anvilPlaneBounds(anvilNorth, 'zNeg', 2, 8 + 6 / 16)).toStrictEqual({ minX: 8 + 4 / 16, maxX: 8 + 12 / 16, minY: 64 + 5 / 16, maxY: 64 + 10 / 16, minZ: 8 + 6 / 16, maxZ: 8 + 6 / 16 })
      expect(anvilPlaneBounds(anvilNorth, 'xNeg', 0, 8)).toStrictEqual({ minX: 8, maxX: 8, minY: 64 + 10 / 16, maxY: 65, minZ: 8 + 3 / 16, maxZ: 8 + 13 / 16 })

      const bedPillowExpectedFaces = {
        north: geometryFaceKey('zPos', [[8, 64 + 5 / 16, 8 + 4 / 16], [9, 64 + 5 / 16, 8 + 4 / 16], [9, 64 + 9 / 16, 8 + 4 / 16], [8, 64 + 9 / 16, 8 + 4 / 16]]),
        south: geometryFaceKey('zNeg', [[9, 64 + 5 / 16, 8 + 12 / 16], [8, 64 + 5 / 16, 8 + 12 / 16], [8, 64 + 9 / 16, 8 + 12 / 16], [9, 64 + 9 / 16, 8 + 12 / 16]]),
        west: geometryFaceKey('xPos', [[8 + 4 / 16, 64 + 5 / 16, 8], [8 + 4 / 16, 64 + 5 / 16, 9], [8 + 4 / 16, 64 + 9 / 16, 9], [8 + 4 / 16, 64 + 9 / 16, 8]]),
        east: geometryFaceKey('xNeg', [[8 + 12 / 16, 64 + 5 / 16, 9], [8 + 12 / 16, 64 + 5 / 16, 8], [8 + 12 / 16, 64 + 9 / 16, 8], [8 + 12 / 16, 64 + 9 / 16, 9]]),
      } as const
      for (const [facing, expectedFace] of Object.entries(bedPillowExpectedFaces)) {
        const bedHead = modelAt(BED, { facing, occupied: true, part: 'head' })
        expect(bedHead.map((quad) => geometryFaceKey(quad.direction, quad.vertices))).toContain(expectedFace)
        expect(bedHead.every((quad) => quad.blockState?.occupied === true)).toBe(true)

        const bedFoot = modelAt(BED, { facing, occupied: false, part: 'foot' })
        expect(bedFoot.map((quad) => geometryFaceKey(quad.direction, quad.vertices))).not.toContain(expectedFace)
        expect(bedFoot.every((quad) => quad.blockState?.part === 'foot' && quad.blockState.occupied === false)).toBe(true)
      }
      const bedBottomBounds = (part: 'head' | 'foot') => vertexBounds(modelAt(BED, { facing: 'north', occupied: false, part })
        .filter((quad) => quad.direction === 'yNeg' && quad.vertices.every(([, y]) => y === 64)))
      expect(bedBottomBounds('head')).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 64, minZ: 8, maxZ: 8 + 3 / 16 })
      expect(bedBottomBounds('foot')).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 64, minZ: 8 + 13 / 16, maxZ: 9 })

      expect(vertexBounds(modelAt(CAULDRON))).toStrictEqual({
        minX: 8,
        maxX: 9,
        minY: 64,
        maxY: 65,
        minZ: 8,
        maxZ: 9,
      })
      const cauldron = modelAt(CAULDRON)
      const wallBottom = 64 + 3 / 16
      const wallPlaneBounds = (direction: string, axis: 0 | 2, coordinate: number) => vertexBounds(cauldron.filter((quad) =>
        quad.direction === direction && quad.vertices.every((vertex) => vertex[axis] === coordinate && vertex[1] >= wallBottom),
      ))
      const wallBounds = (minX: number, maxX: number, minZ: number, maxZ: number) => ({
        minX,
        maxX,
        minY: wallBottom,
        maxY: 65,
        minZ,
        maxZ,
      })
      expect(wallPlaneBounds('zNeg', 2, 8)).toStrictEqual(wallBounds(8, 9, 8, 8))
      expect(wallPlaneBounds('zPos', 2, 9)).toStrictEqual(wallBounds(8, 9, 9, 9))
      expect(wallPlaneBounds('xNeg', 0, 8)).toStrictEqual(wallBounds(8, 8, 8, 9))
      expect(wallPlaneBounds('xPos', 0, 9)).toStrictEqual(wallBounds(9, 9, 8, 9))
      expect(wallPlaneBounds('zPos', 2, 8 + 2 / 16)).toStrictEqual(wallBounds(8, 9, 8 + 2 / 16, 8 + 2 / 16))
      expect(wallPlaneBounds('zNeg', 2, 8 + 14 / 16)).toStrictEqual(wallBounds(8, 9, 8 + 14 / 16, 8 + 14 / 16))
      expect(wallPlaneBounds('xPos', 0, 8 + 2 / 16)).toStrictEqual(wallBounds(8 + 2 / 16, 8 + 2 / 16, 8 + 2 / 16, 8 + 14 / 16))
      expect(wallPlaneBounds('xNeg', 0, 8 + 14 / 16)).toStrictEqual(wallBounds(8 + 14 / 16, 8 + 14 / 16, 8 + 2 / 16, 8 + 14 / 16))
      const waterTopByLevel = { 1: 64 + 6 / 16, 2: 64 + 9 / 16, 3: 64 + 12 / 16 } as const
      for (const level of [1, 2, 3] as const) {
        const waterCauldron = modelAt(WATER_CAULDRON, { level })
        const waterTop = waterTopByLevel[level]
        expect(waterCauldron.some((quad) => quad.direction === 'yPos' && quad.vertices.every(([, y]) => y === waterTop))).toBe(true)
        expect(waterCauldron.every((quad) => quad.blockState?.level === level)).toBe(true)
      }

      const hopper = (facing: 'down' | 'north' | 'south' | 'west' | 'east') => modelAt(HOPPER, { facing, enabled: true })
      expect(vertexBounds(hopper('down'))).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 9 })
      for (const facing of ['north', 'south', 'west', 'east'] as const) {
        expect(vertexBounds(hopper(facing))).toStrictEqual({ minX: 8, maxX: 9, minY: 64 + 4 / 16, maxY: 65, minZ: 8, maxZ: 9 })
      }
      const hopperOutletBounds = (facing: 'north' | 'south' | 'west' | 'east') => {
        const endFace = facing === 'north' ? 'zNeg' : facing === 'south' ? 'zPos' : facing === 'west' ? 'xNeg' : 'xPos'
        const axis: 0 | 2 = facing === 'east' || facing === 'west' ? 0 : 2
        const coordinate = facing === 'north' || facing === 'west' ? 8 : 9
        return vertexBounds(hopper(facing).filter((quad) => quad.direction === endFace && quad.vertices.every((vertex) =>
          vertex[axis] === coordinate && vertex[1] >= 64 + 4 / 16 && vertex[1] <= 64 + 8 / 16,
        )))
      }
      expect(hopperOutletBounds('north')).toStrictEqual({ minX: 8 + 6 / 16, maxX: 8 + 10 / 16, minY: 64 + 4 / 16, maxY: 64 + 8 / 16, minZ: 8, maxZ: 8 })
      expect(hopperOutletBounds('south')).toStrictEqual({ minX: 8 + 6 / 16, maxX: 8 + 10 / 16, minY: 64 + 4 / 16, maxY: 64 + 8 / 16, minZ: 9, maxZ: 9 })
      expect(hopperOutletBounds('west')).toStrictEqual({ minX: 8, maxX: 8, minY: 64 + 4 / 16, maxY: 64 + 8 / 16, minZ: 8 + 6 / 16, maxZ: 8 + 10 / 16 })
      expect(hopperOutletBounds('east')).toStrictEqual({ minX: 9, maxX: 9, minY: 64 + 4 / 16, maxY: 64 + 8 / 16, minZ: 8 + 6 / 16, maxZ: 8 + 10 / 16 })

      for (const [mode, powered] of [['compare', false], ['subtract', true]] as const) {
        const comparator = modelAt(COMPARATOR, { facing: 'west', mode, powered })
        expect(vertexBounds(comparator)).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 64 + 7 / 16, minZ: 8, maxZ: 9 })
        expect(comparator.every((quad) => quad.blockState?.mode === mode && quad.blockState.powered === powered)).toBe(true)
      }

      const comparatorTorchTopsByFacing = {
        north: [
          geometryFaceKey('yPos', [[8 + 4 / 16, 64 + 7 / 16, 8 + 3 / 16], [8 + 6 / 16, 64 + 7 / 16, 8 + 3 / 16], [8 + 6 / 16, 64 + 7 / 16, 8 + 5 / 16], [8 + 4 / 16, 64 + 7 / 16, 8 + 5 / 16]]),
          geometryFaceKey('yPos', [[8 + 10 / 16, 64 + 7 / 16, 8 + 3 / 16], [8 + 12 / 16, 64 + 7 / 16, 8 + 3 / 16], [8 + 12 / 16, 64 + 7 / 16, 8 + 5 / 16], [8 + 10 / 16, 64 + 7 / 16, 8 + 5 / 16]]),
        ],
        east: [
          geometryFaceKey('yPos', [[8 + 11 / 16, 64 + 7 / 16, 8 + 4 / 16], [8 + 13 / 16, 64 + 7 / 16, 8 + 4 / 16], [8 + 13 / 16, 64 + 7 / 16, 8 + 6 / 16], [8 + 11 / 16, 64 + 7 / 16, 8 + 6 / 16]]),
          geometryFaceKey('yPos', [[8 + 11 / 16, 64 + 7 / 16, 8 + 10 / 16], [8 + 13 / 16, 64 + 7 / 16, 8 + 10 / 16], [8 + 13 / 16, 64 + 7 / 16, 8 + 12 / 16], [8 + 11 / 16, 64 + 7 / 16, 8 + 12 / 16]]),
        ],
        south: [
          geometryFaceKey('yPos', [[8 + 10 / 16, 64 + 7 / 16, 8 + 11 / 16], [8 + 12 / 16, 64 + 7 / 16, 8 + 11 / 16], [8 + 12 / 16, 64 + 7 / 16, 8 + 13 / 16], [8 + 10 / 16, 64 + 7 / 16, 8 + 13 / 16]]),
          geometryFaceKey('yPos', [[8 + 4 / 16, 64 + 7 / 16, 8 + 11 / 16], [8 + 6 / 16, 64 + 7 / 16, 8 + 11 / 16], [8 + 6 / 16, 64 + 7 / 16, 8 + 13 / 16], [8 + 4 / 16, 64 + 7 / 16, 8 + 13 / 16]]),
        ],
        west: [
          geometryFaceKey('yPos', [[8 + 3 / 16, 64 + 7 / 16, 8 + 4 / 16], [8 + 5 / 16, 64 + 7 / 16, 8 + 4 / 16], [8 + 5 / 16, 64 + 7 / 16, 8 + 6 / 16], [8 + 3 / 16, 64 + 7 / 16, 8 + 6 / 16]]),
          geometryFaceKey('yPos', [[8 + 3 / 16, 64 + 7 / 16, 8 + 10 / 16], [8 + 5 / 16, 64 + 7 / 16, 8 + 10 / 16], [8 + 5 / 16, 64 + 7 / 16, 8 + 12 / 16], [8 + 3 / 16, 64 + 7 / 16, 8 + 12 / 16]]),
        ],
      } as const
      for (const [facing, expected] of Object.entries(comparatorTorchTopsByFacing)) {
        const comparator = modelAt(COMPARATOR, { facing, mode: 'compare', powered: true })
        expect(geometryFaceKeysOnPlane(comparator, 'yPos', 1, 64 + 7 / 16)).toStrictEqual([...expected].sort())
      }

      const enchantingTable = modelAt(ENCHANTING_TABLE)
      expect(vertexBounds(enchantingTable)).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 64 + 12 / 16, minZ: 8, maxZ: 9 })
      const brewingStand = modelAt(BREWING_STAND, { has_bottle_0: true, has_bottle_1: false, has_bottle_2: true })
      const emptyBrewingStand = modelAt(BREWING_STAND, { has_bottle_0: false, has_bottle_1: false, has_bottle_2: false })
      expect(vertexBounds(brewingStand)).toStrictEqual({
        minX: 8 + 2 / 16,
        maxX: 8 + 14 / 16,
        minY: 64,
        maxY: 64 + 14 / 16,
        minZ: 8 + 2 / 16,
        maxZ: 8 + 14 / 16,
      })
      expect(brewingStand.length).toBeGreaterThan(emptyBrewingStand.length)
      const bottleOneOnly = modelAt(BREWING_STAND, { has_bottle_0: false, has_bottle_1: true, has_bottle_2: false })
      expect(geometryFaceKeysOnPlane(bottleOneOnly, 'yPos', 1, 64 + 10 / 16)).toStrictEqual([
        geometryFaceKey('yPos', [[8 + 9 / 16, 64 + 10 / 16, 8 + 7 / 16], [8 + 12 / 16, 64 + 10 / 16, 8 + 7 / 16], [8 + 12 / 16, 64 + 10 / 16, 8 + 4 / 16], [8 + 9 / 16, 64 + 10 / 16, 8 + 4 / 16]]),
      ])

      const rodBoundsByFacing = {
        up: { minX: 8 + 7 / 16, maxX: 8 + 9 / 16, minY: 64, maxY: 65, minZ: 8 + 7 / 16, maxZ: 8 + 9 / 16 },
        down: { minX: 8 + 7 / 16, maxX: 8 + 9 / 16, minY: 64, maxY: 65, minZ: 8 + 7 / 16, maxZ: 8 + 9 / 16 },
        north: { minX: 8 + 7 / 16, maxX: 8 + 9 / 16, minY: 64 + 7 / 16, maxY: 64 + 9 / 16, minZ: 8, maxZ: 9 },
        south: { minX: 8 + 7 / 16, maxX: 8 + 9 / 16, minY: 64 + 7 / 16, maxY: 64 + 9 / 16, minZ: 8, maxZ: 9 },
        east: { minX: 8, maxX: 9, minY: 64 + 7 / 16, maxY: 64 + 9 / 16, minZ: 8 + 7 / 16, maxZ: 8 + 9 / 16 },
        west: { minX: 8, maxX: 9, minY: 64 + 7 / 16, maxY: 64 + 9 / 16, minZ: 8 + 7 / 16, maxZ: 8 + 9 / 16 },
      } as const
      for (const [facing, expected] of Object.entries(rodBoundsByFacing)) {
        expect(vertexBounds(modelAt(END_ROD, { facing }))).toStrictEqual(expected)
      }

      const pistonShortBoundsByFacing = {
        up: { minX: 8, maxX: 9, minY: 64 + 4 / 16, maxY: 65, minZ: 8, maxZ: 9 },
        down: { minX: 8, maxX: 9, minY: 64, maxY: 64 + 12 / 16, minZ: 8, maxZ: 9 },
        north: { minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 8 + 12 / 16 },
        south: { minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8 + 4 / 16, maxZ: 9 },
        west: { minX: 8, maxX: 8 + 12 / 16, minY: 64, maxY: 65, minZ: 8, maxZ: 9 },
        east: { minX: 8 + 4 / 16, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 9 },
      } as const
      for (const [facing, expected] of Object.entries(pistonShortBoundsByFacing)) {
        const pistonHead = modelAt(PISTON_HEAD, { facing, short: true, type: 'sticky' })
        expect(vertexBounds(pistonHead)).toStrictEqual(expected)
        expect(pistonHead.every((quad) => quad.blockState?.facing === facing && quad.blockState.type === 'sticky' && quad.blockState.short === true)).toBe(true)
      }
      for (const facing of ['up', 'down', 'north', 'south', 'west', 'east'] as const) {
        const pistonHead = modelAt(PISTON_HEAD, { facing, short: false, type: 'normal' })
        expect(vertexBounds(pistonHead)).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 9 })
      }

      expect(vertexBounds(modelAt(DRAGON_EGG))).toStrictEqual({
        minX: 8 + 2 / 16,
        maxX: 8 + 14 / 16,
        minY: 64,
        maxY: 65,
        minZ: 8 + 2 / 16,
        maxZ: 8 + 14 / 16,
      })
      const netherX = modelAt(NETHER_PORTAL, { axis: 'x' })
      const netherZ = modelAt(NETHER_PORTAL, { axis: 'z' })
      expect(vertexBounds(netherX)).toStrictEqual({ minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8 + 8 / 16, maxZ: 8 + 8 / 16 })
      expect(vertexBounds(netherZ)).toStrictEqual({ minX: 8 + 8 / 16, maxX: 8 + 8 / 16, minY: 64, maxY: 65, minZ: 8, maxZ: 9 })

      const fireDisconnected = modelAt(FIRE, { age: 0, connections: { north: false, east: false, south: false, west: false, up: false } })
      const fireConnected = modelAt(FIRE, { age: 15, connections: { north: false, east: false, south: false, west: false, up: true } })
      const fireAgainstNorthWall = modelAt(FIRE, { age: 0, connections: { north: true, east: false, south: false, west: false, up: false } })
      const fireAgainstEverySide = modelAt(FIRE, { age: 15, connections: { north: true, east: true, south: true, west: true, up: true } })
      expect(fireDisconnected).toHaveLength(4)
      expect(fireConnected).toHaveLength(6)
      expect(fireAgainstNorthWall).toHaveLength(5)
      expect(fireConnected.every((quad) => quad.blockState?.age === 15)).toBe(true)
      expect(fireAgainstEverySide).toHaveLength(10)
      expect(fireAgainstEverySide.some((quad) => quad.direction === 'xPos' && vertexBounds([quad]).minZ === 8 && vertexBounds([quad]).maxZ === 9)).toBe(true)
      expect(fireAgainstEverySide.some((quad) => quad.direction === 'zPos' && vertexBounds([quad]).minX === 8 && vertexBounds([quad]).maxX === 9)).toBe(true)
      expect(fireAgainstEverySide.some((quad) => quad.direction === 'xNeg' && vertexBounds([quad]).minZ === 8 && vertexBounds([quad]).maxZ === 9)).toBe(true)

      const skull = modelAt(WITHER_SKELETON_SKULL, { powered: true, rotation: 15 })
      expect(vertexBounds(skull)).toStrictEqual({ minX: 8 + 4 / 16, maxX: 8 + 12 / 16, minY: 64 + 4 / 16, maxY: 64 + 12 / 16, minZ: 8 + 4 / 16, maxZ: 8 + 12 / 16 })
      expect(skull.every((quad) => quad.blockState?.rotation === 15 && quad.blockState.powered === true)).toBe(true)

      expect(vertexBounds(modelAt(CHORUS_FLOWER, { age: 0 }))).toStrictEqual({ minX: 8 + 2 / 16, maxX: 8 + 14 / 16, minY: 64, maxY: 65, minZ: 8 + 2 / 16, maxZ: 8 + 14 / 16 })
      expect(vertexBounds(modelAt(CHORUS_FLOWER, { age: 5 }))).toStrictEqual({ minX: 8 + 4 / 16, maxX: 8 + 12 / 16, minY: 64, maxY: 65, minZ: 8 + 4 / 16, maxZ: 8 + 12 / 16 })
      const chorusBranch = modelAt(CHORUS_PLANT, { connections: { down: false, north: false, east: false, south: false, west: true, up: false } })
      expect(vertexBounds(chorusBranch)).toStrictEqual({ minX: 8, maxX: 8 + 10 / 16, minY: 64 + 6 / 16, maxY: 64 + 10 / 16, minZ: 8 + 6 / 16, maxZ: 8 + 10 / 16 })
    }),
  )

  it.effect('matches independently derived closed and opened door panel geometry', () =>
    Effect.sync(() => {
      const facings = ['north', 'east', 'south', 'west'] as const
      const hinges = ['left', 'right'] as const
      const halves = ['lower', 'upper'] as const
      const expectedEdge = {
        north: { closed: 'south', opened: { left: 'west', right: 'east' } },
        east: { closed: 'west', opened: { left: 'north', right: 'south' } },
        south: { closed: 'north', opened: { left: 'east', right: 'west' } },
        west: { closed: 'east', opened: { left: 'south', right: 'north' } },
      } as const
      const expectedBoundsByEdge = {
        west: { minX: 8, maxX: 8 + 3 / 16, minY: 64, maxY: 65, minZ: 8, maxZ: 9 },
        east: { minX: 8 + 13 / 16, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 9 },
        north: { minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8, maxZ: 8 + 3 / 16 },
        south: { minX: 8, maxX: 9, minY: 64, maxY: 65, minZ: 8 + 13 / 16, maxZ: 9 },
      } as const

      for (const facing of facings) {
        for (const hinge of hinges) {
          for (const open of [false, true]) {
            for (const half of halves) {
              const encodedState = encodeState(DOOR, { facing, hinge, open, half })
              const quads = Result.getOrThrow(meshSpecialBlocks(
                SPECIAL_LOOKUP,
                chunkWithStates([[8, 64, 8, DOOR]], [[8, 64, 8, encodedState]]),
                {},
                CHUNK_HEIGHT,
              ))
              const edge = open ? expectedEdge[facing].opened[hinge] : expectedEdge[facing].closed
              const expectedBounds = expectedBoundsByEdge[edge]

              expect(quads.map((quad) => geometryFaceKey(quad.direction, quad.vertices)).sort())
                .toStrictEqual(boxGeometryFaceKeys(expectedBounds))
              expect(vertexBounds(quads)).toStrictEqual(expectedBounds)
              expect(quads.every((quad) =>
                quad.blockState?.facing === facing && quad.blockState.hinge === hinge &&
                quad.blockState.open === open && quad.blockState.half === half,
              )).toBe(true)
            }
          }
        }
      }
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

  it.effect('keeps an unknown block id on its neutral mesh path when state storage is omitted', () =>
    Effect.sync(() => {
      const customBlockId = Result.getOrThrow(KernelBlockId.result(300))
      const config = { ...MESH_CONFIG, transparentSolidBlockIds: new Set([customBlockId]) }
      const layers = Result.getOrThrow(meshChunk(
        chunkWith([[8, 64, 8, customBlockId]]),
        {},
        config,
      ))

      expect(layers.transparentSolid).toHaveLength(6)
      expect(layers.transparentSolid.every((quad) => quad.blockId === customBlockId && !Object.hasOwn(quad, 'blockState'))).toBe(true)
      expect(layers.specialBlocks.some((quad) => quad.blockId === customBlockId)).toBe(false)
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

  it.effect('meshes every rail shape and each redstone wire arm direction', () =>
    Effect.sync(() => {
      const cells: Array<readonly [number, number, number, number]> = []
      const states: Array<readonly [number, number, number, number]> = []
      const records: Array<{
        readonly blockId: BlockId
        readonly position: readonly [number, number, number]
        readonly state: Readonly<Record<string, unknown>>
      }> = []
      const railRecords: Array<{ readonly record: typeof records[number]; readonly shape: RailShapeValue }> = []
      const wireRecords: Array<{
        readonly record: typeof records[number]
        readonly connection: 'none' | 'side' | 'up'
      }> = []
      const place = (blockId: BlockId, state: Readonly<Record<string, unknown>>) => {
        const index = records.length
        const position = [(index % 8) * 2, 64, Math.floor(index / 8) * 2] as const
        cells.push([position[0], position[1], position[2], blockId])
        states.push([position[0], position[1], position[2], encodeState(blockId, state)])
        const record = { blockId, position, state }
        records.push(record)
        return record
      }

      const railShapes = [
        'north_south', 'east_west',
        'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south',
        'south_east', 'south_west', 'north_west', 'north_east',
      ] as const
      for (const shape of railShapes) {
        railRecords.push({ record: place(RAIL, { shape }), shape })
      }

      const directions = ['north', 'east', 'south', 'west'] as const
      for (const direction of directions) {
        for (const connection of ['none', 'side', 'up'] as const) {
          const connections = { north: 'none', east: 'none', south: 'none', west: 'none', [direction]: connection }
          wireRecords.push({ record: place(REDSTONE_WIRE, { connections, power: 7 }), connection })
        }
      }

      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(cells, states),
        {},
        CHUNK_HEIGHT,
      ))
      const quadsAt = (record: typeof records[number]) => {
        const [lx, y, lz] = record.position
        return quads.filter((quad) => quad.vertices.every(([x, vertexY, z]) =>
          x >= lx && x <= lx + 1 && z >= lz && z <= lz + 1 && vertexY >= y && vertexY <= y + 1 + 1 / 16,
        ))
      }

      for (const { record, shape } of railRecords) {
        const railQuads = quadsAt(record)
        expect(railQuads).toHaveLength(2)
        expect(railQuads.every((quad) => quad.kind === 'rail' && quad.blockState?.shape === shape)).toBe(true)
        const top = railQuads.find((quad) => quad.kind === 'rail' && quad.role === 'top')
        const bottom = railQuads.find((quad) => quad.kind === 'rail' && quad.role === 'bottom')
        const [lx, y, lz] = record.position
        const expectedVertices = EXPECTED_RAIL_VERTICES[shape].map(([x, vertexY, z]) => [lx + x, y + vertexY, lz + z] as const)
        expect(sortedVertexKey(top?.vertices ?? [])).toBe(sortedVertexKey(expectedVertices))
        expect(sortedVertexKey(bottom?.vertices ?? [])).toBe(sortedVertexKey(expectedVertices))
      }

      const connectionQuadCounts = { none: 1, side: 2, up: 2 } as const
      for (const { record, connection } of wireRecords) {
        const wireQuads = quadsAt(record)
        expect(wireQuads).toHaveLength(connectionQuadCounts[connection])
        expect(wireQuads.every((quad) => quad.kind === 'redstoneWire' && quad.blockState?.power === 7)).toBe(true)
        if (connection === 'up') {
          expect(wireQuads.some((quad) => quad.vertices.some(([, y]) => y > 64 + 1))).toBe(true)
        }
      }
    }),
  )

  it.effect('meshes every stair, ladder, button, lever, and repeater state orientation', () =>
    Effect.sync(() => {
      const cells: Array<readonly [number, number, number, number]> = []
      const states: Array<readonly [number, number, number, number]> = []
      const records: Array<{
        readonly blockId: BlockId
        readonly position: readonly [number, number, number]
        readonly state: Readonly<Record<string, unknown>>
      }> = []
      const stairRecords: Array<{
        readonly record: typeof records[number]
        readonly facing: StairFacingValue
        readonly half: StairHalfValue
        readonly shape: StairShapeValue
      }> = []
      const place = (blockId: BlockId, state: Readonly<Record<string, unknown>>) => {
        const index = records.length
        const position = [((index % 8) * 2), 64 + Math.floor(index / 64) * 2, (Math.floor(index % 64 / 8) * 2)] as const
        cells.push([position[0], position[1], position[2], blockId])
        states.push([position[0], position[1], position[2], encodeState(blockId, state)])
        const record = { blockId, position, state }
        records.push(record)
        return record
      }

      const facings = ['north', 'east', 'south', 'west'] as const
      const stairShapes = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'] as const
      for (const facing of facings) {
        for (const half of ['bottom', 'top'] as const) {
          for (const shape of stairShapes) {
            stairRecords.push({ record: place(STAIRS, { facing, half, shape }), facing, half, shape })
          }
        }
      }
      for (const facing of facings) {
        place(LADDER, { facing })
      }
      for (const facing of facings) {
        for (const face of ['floor', 'wall', 'ceiling'] as const) {
          for (const powered of [false, true]) {
            place(STONE_BUTTON, { facing, face, powered })
          }
        }
      }
      const leverRecords = new Map<string, { readonly off: typeof records[number]; readonly on: typeof records[number] }>()
      for (const facing of facings) {
        for (const face of ['floor', 'wall', 'ceiling'] as const) {
          const off = place(LEVER, { facing, face, powered: false })
          const on = place(LEVER, { facing, face, powered: true })
          leverRecords.set(`${facing}:${face}`, { off, on })
        }
      }
      const repeaterRecords = new Map<string, { readonly unlocked: typeof records[number]; readonly locked: typeof records[number] }>()
      for (const facing of facings) {
        for (const delay of [1, 2, 3, 4] as const) {
          const unlocked = place(REPEATER, { facing, delay, locked: false })
          const locked = place(REPEATER, { facing, delay, locked: true })
          repeaterRecords.set(`${facing}:${delay}`, { unlocked, locked })
        }
      }

      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(cells, states),
        {},
        CHUNK_HEIGHT,
      ))
      const quadsAt = (record: typeof records[number]) => {
        const [lx, y, lz] = record.position
        return quads.filter((quad) => quad.vertices.every(([x, vertexY, z]) =>
          x >= lx && x <= lx + 1 && z >= lz && z <= lz + 1 && vertexY >= y && vertexY <= y + 1,
        ))
      }
      const keyOf = (record: typeof records[number]): string => quadsAt(record)
        .flatMap((quad) => quad.vertices.map((vertex) => vertex.join(',')))
        .sort()
        .join('|')

      for (const { record, facing, half, shape } of stairRecords) {
        const stairQuads = quadsAt(record)
        expect(stairQuads.every((quad) => quad.kind === 'stairs')).toBe(true)
        expect(stairQuads.map((quad) => geometryFaceKey(quad.direction, quad.vertices)).sort())
          .toStrictEqual(expectedStairFaceKeys(record.position, facing, half, shape))
      }

      for (const record of records) {
        const cellQuads = quadsAt(record)
        expect(cellQuads.length).toBeGreaterThan(0)
        expect(cellQuads.every((quad) => quad.blockId === record.blockId)).toBe(true)
        for (const [property, value] of Object.entries(record.state)) {
          expect(cellQuads.every((quad) => {
            const state = Reflect.get(quad, 'blockState')
            return typeof state === 'object' && state !== null && Reflect.get(state, property) === value
          })).toBe(true)
        }
      }
      for (const { off, on } of leverRecords.values()) {
        const offBounds = vertexBounds(quadsAt(off))
        const onBounds = vertexBounds(quadsAt(on))
        expect(offBounds.maxY - offBounds.minY).toBeGreaterThan(onBounds.maxY - onBounds.minY)
      }
      for (const [key, { unlocked, locked }] of repeaterRecords) {
        expect(quadsAt(locked).length).toBeGreaterThan(quadsAt(unlocked).length)
        if (key.endsWith(':1')) {
          const facing = key.slice(0, key.indexOf(':'))
          const fourTick = repeaterRecords.get(`${facing}:4`)?.unlocked
          expect(fourTick).toBeDefined()
          if (typeof fourTick === 'undefined') {
            throw new Error(`Expected four-tick repeater for ${facing}`)
          }
          expect(keyOf(unlocked)).not.toBe(keyOf(fourTick))
        }
      }
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

  it.effect('preserves cactus faces that do not meet adjacent geometry', () =>
    Effect.sync(() => {
      const adjacent = Result.getOrThrow(meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, CACTUS],
        ]),
        {},
        MESH_CONFIG,
      ))
      expect(adjacent.specialBlocks).toHaveLength(12)

      const blocked = Result.getOrThrow(meshChunk(
        chunkWith([
          [8, 64, 8, CACTUS],
          [9, 64, 8, OPAQUE_CUBE],
        ]),
        {},
        MESH_CONFIG,
      ))
      expect(blocked.specialBlocks).toHaveLength(6)
      expect(blocked.specialBlocks.every((quad) => quad.kind === 'cactus')).toBe(true)
      expect(blocked.opaque.length).toBeGreaterThan(0)
    }),
  )

  it.effect('emits the lily-pad top when an above block does not reach its plane', () =>
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
      expect(covered).toHaveLength(1)
      expect(covered[0]).toMatchObject({ direction: 'yPos', kind: 'lilyPad', role: 'top' })

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

  it.effect('keeps rail planes below an opaque block that does not reach them', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([
          [8, 64, 8, RAIL],
          [8, 65, 8, OPAQUE_CUBE],
        ]),
        {},
        CHUNK_HEIGHT,
      ))
      const rails = quads.filter((quad): quad is RailSpecialBlockQuad => quad.kind === 'rail')
      expect(rails).toHaveLength(2)
      expect(new Set(rails.map((quad) => quad.role))).toStrictEqual(new Set(['top', 'bottom']))
    }),
  )

  it.effect('culls repeater boundary faces behind opaque neighbours', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([
          [8, 64, 8, REPEATER],
          [9, 64, 8, OPAQUE_CUBE],
        ]),
        {},
        CHUNK_HEIGHT,
        Reflect.get({}, 'region'),
        MESH_CONFIG,
      ))

      expect(quads.filter((quad) =>
        quad.blockId === REPEATER && quad.direction === 'xPos' && quad.vertices.every(([x]) => x === 9),
      )).toHaveLength(0)
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

  it.effect('routes block models through merged, naive, and regional mesh entry points', () =>
    Effect.sync(() => {
      const chunk = chunkWith([
        [1, 6, 1, TORCH],
        [8, 64, 8, FARMLAND],
      ])
      const merged = Result.getOrThrow(meshChunk(chunk, {}, MESH_CONFIG))
      const naive = Result.getOrThrow(meshChunkNaive(chunk, {}, MESH_CONFIG))
      const regional = Result.getOrThrow(meshChunkRegion(chunk, {}, MESH_CONFIG, {
        min: [0, 0, 0],
        max: [4, 10, 4],
      }))

      expect(merged.specialBlocks).toStrictEqual(naive.specialBlocks)
      expect(merged.specialBlocks.some((quad) => quad.blockId === TORCH && quad.kind === 'blockModel')).toBe(true)
      expect(regional.layers.specialBlocks).toStrictEqual(merged.specialBlocks.filter((quad) => quad.blockId === TORCH))
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

  it.effect('propagates unregistered neighbour failures through voxel and attached special geometry', () =>
    Effect.sync(() => {
      const unknownId = Result.getOrThrow(KernelBlockId.result(300))
      const cases = [
        {
          cells: [[8, 64, 8, STAIRS], [9, 64, 8, unknownId]] as const,
          stateCells: [],
        },
        {
          cells: [[8, 64, 8, LEVER], [9, 64, 8, unknownId]] as const,
          stateCells: [[8, 64, 8, encodeState(LEVER, { facing: 'east', face: 'wall', powered: false })]] as const,
        },
        {
          cells: [[8, 64, 8, REPEATER], [9, 64, 8, unknownId]] as const,
          stateCells: [],
        },
        {
          cells: [[8, 64, 8, REPEATER], [7, 64, 8, unknownId]] as const,
          stateCells: [],
        },
        {
          cells: [[8, 64, 8, REPEATER], [8, 63, 8, unknownId]] as const,
          stateCells: [],
        },
        {
          cells: [[8, 64, 8, REPEATER], [8, 64, 7, unknownId]] as const,
          stateCells: [],
        },
        {
          cells: [[8, 64, 8, REPEATER], [8, 64, 9, unknownId]] as const,
          stateCells: [],
        },
        {
          cells: [[8, 64, 8, RAIL], [8, 65, 8, unknownId]] as const,
          stateCells: [],
        },
      ]

      for (const { cells, stateCells } of cases) {
        const chunk = stateCells.length === 0
          ? chunkWith(cells)
          : chunkWithStates(cells, stateCells)
        expect(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT, Reflect.get({}, 'region'), MESH_CONFIG)).toStrictEqual(
          Result.fail({ _tag: 'MissingSpecialBlockLookupEntry', blockId: unknownId }),
        )
      }
    }),
  )

  it.effect('propagates missing lookup entries from every repeater boundary face', () =>
    Effect.sync(() => {
      const unknownId = Result.getOrThrow(KernelBlockId.result(300))
      const region = { max: [9, 65, 9], min: [8, 64, 8] } as const
      const cases = [
        [[7, 64, 8, unknownId]] as const,
        [[9, 64, 8, unknownId]] as const,
        [[8, 63, 8, unknownId]] as const,
        [[8, 64, 7, unknownId]] as const,
        [[8, 64, 9, unknownId]] as const,
      ]

      for (const cells of cases) {
        const chunk = chunkWith([[8, 64, 8, REPEATER], ...cells])
        expect(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT, region, MESH_CONFIG)).toStrictEqual(
          Result.fail({ _tag: 'MissingSpecialBlockLookupEntry', blockId: unknownId }),
        )
      }
    }),
  )

  it.effect('propagates a missing neighbour lookup from locked repeater markers', () =>
    Effect.sync(() => {
      const unknownId = Result.getOrThrow(KernelBlockId.result(300))
      const lockedState = encodeState(REPEATER, { facing: 'east', delay: 1, locked: true })
      const chunk = chunkWithStates(
        [[8, 64, 8, REPEATER], [8, 64, 9, unknownId]],
        [[8, 64, 8, lockedState]],
      )
      const repeaterOnlyRegion = { min: [8, 64, 8], max: [9, 65, 9] } as const

      expect(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT, repeaterOnlyRegion)).toStrictEqual(
        Result.fail({ _tag: 'MissingSpecialBlockLookupEntry', blockId: unknownId }),
      )
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

  it('propagates kernel block-type lookup failures while building the special lookup', async () => {
    vi.resetModules()
    const failure = { _tag: 'InjectedBlockTypeFailure' }
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      const mockedBlockTypeOfId: typeof kernel.blockTypeOfId = (blockId) => blockId === CACTUS
        ? invalidFixture(Result.fail(failure))
        : kernel.blockTypeOfId(blockId)
      return {
        ...kernel,
        blockTypeOfId: mockedBlockTypeOfId,
      }
    })
    try {
      const { SPECIAL_BLOCK_LOOKUP: lookupResult } = await import('../src/domain/special-mesh.js')
      expect(lookupResult).toStrictEqual(Result.fail(failure))
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('rejects a registered special block whose kernel lookup omits its block type', async () => {
    vi.resetModules()
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      const mockedBlockTypeOfId: typeof kernel.blockTypeOfId = (blockId) => blockId === CACTUS
        ? Result.succeed(Reflect.get({}, 'type'))
        : kernel.blockTypeOfId(blockId)
      return { ...kernel, blockTypeOfId: mockedBlockTypeOfId }
    })
    try {
      const { SPECIAL_BLOCK_LOOKUP: lookupResult } = await import('../src/domain/special-mesh.js')
      expect(lookupResult).toStrictEqual(Result.fail({ _tag: 'MissingSpecialBlockType', blockId: CACTUS }))
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('returns MissingSpecialBlockType when the kernel omits a type during cell meshing', async () => {
    vi.resetModules()
    let omitTypeDuringMeshing = false
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      const mockedBlockTypeOfId: typeof kernel.blockTypeOfId = (blockId) => omitTypeDuringMeshing && blockId === TORCH
        ? Result.succeed(Reflect.get({}, 'type'))
        : kernel.blockTypeOfId(blockId)
      return { ...kernel, blockTypeOfId: mockedBlockTypeOfId }
    })
    try {
      const specialMesh = await import('../src/domain/special-mesh.js')
      const lookup = Result.getOrThrow(specialMesh.SPECIAL_BLOCK_LOOKUP)
      omitTypeDuringMeshing = true
      expect(specialMesh.meshSpecialBlocks(
        lookup,
        chunkWith([[8, 64, 8, TORCH]]),
        {},
        CHUNK_HEIGHT,
      )).toStrictEqual(Result.fail({ _tag: 'MissingSpecialBlockType', blockId: TORCH }))
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('propagates block-type registry failures during special cell meshing', async () => {
    vi.resetModules()
    let failDuringMeshing = false
    const failure = { _tag: 'InjectedBlockTypeFailure' }
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      const mockedBlockTypeOfId: typeof kernel.blockTypeOfId = (blockId) => failDuringMeshing && blockId === CHEST
        ? invalidFixture(Result.fail(failure))
        : kernel.blockTypeOfId(blockId)
      return { ...kernel, blockTypeOfId: mockedBlockTypeOfId }
    })
    try {
      const specialMesh = await import('../src/domain/special-mesh.js')
      const lookup = Result.getOrThrow(specialMesh.SPECIAL_BLOCK_LOOKUP)
      failDuringMeshing = true
      expect(specialMesh.meshSpecialBlocks(
        lookup,
        chunkWith([[8, 64, 8, CHEST]]),
        {},
        CHUNK_HEIGHT,
      )).toStrictEqual(Result.fail(failure))
    } finally {
      vi.doUnmock('@nerima-games/mc-kernel')
      vi.resetModules()
    }
  })

  it('returns typed failures for malformed effective state properties', async () => {
    vi.resetModules()
    let effectiveState = invalidFixture<EffectiveBlockStateValues>({})
    vi.doMock('@nerima-games/mc-kernel', async () => {
      const kernel = await vi.importActual<typeof import('@nerima-games/mc-kernel')>('@nerima-games/mc-kernel')
      return {
        ...kernel,
        effectiveBlockStateOf: invalidFixture<typeof kernel.effectiveBlockStateOf>(
          () => Result.succeed(effectiveState),
        ),
      }
    })
    try {
      const { SPECIAL_BLOCK_LOOKUP: lookupResult, meshSpecialBlocks: meshSpecials } =
        await import('../src/domain/special-mesh.js')
      const lookup = Result.getOrThrow(lookupResult)
      const invalidCases: ReadonlyArray<{
        readonly blockId: BlockId
        readonly state: Readonly<Record<string, unknown>>
        readonly property: string
      }> = [
        { blockId: STAIRS, state: {}, property: 'facing' },
        { blockId: STAIRS, state: { facing: 'north' }, property: 'half' },
        { blockId: STAIRS, state: { facing: 'north', half: 'bottom' }, property: 'shape' },
        { blockId: DOOR, state: {}, property: 'facing' },
        { blockId: DOOR, state: { facing: 'north' }, property: 'hinge' },
        { blockId: DOOR, state: { facing: 'north', hinge: 'middle' }, property: 'hinge' },
        { blockId: DOOR, state: { facing: 'north', hinge: 'left', half: 'middle' }, property: 'half' },
        { blockId: DOOR, state: { facing: 'north', hinge: 'left', half: 'lower' }, property: 'open' },
        { blockId: DOOR, state: { facing: 'north', hinge: 'left', half: 'lower', open: 'false' }, property: 'open' },
        { blockId: SLAB, state: {}, property: 'type' },
        { blockId: SLAB, state: { type: 'middle' }, property: 'type' },
        { blockId: PRESSURE_PLATE, state: {}, property: 'powered' },
        { blockId: PRESSURE_PLATE, state: { powered: 1 }, property: 'powered' },
        { blockId: SNOW, state: {}, property: 'layers' },
        { blockId: SNOW, state: { layers: 9 }, property: 'layers' },
        { blockId: LADDER, state: {}, property: 'facing' },
        { blockId: STONE_BUTTON, state: {}, property: 'facing' },
        { blockId: STONE_BUTTON, state: { facing: 'north' }, property: 'face' },
        { blockId: STONE_BUTTON, state: { facing: 'north', face: 'side' }, property: 'face' },
        { blockId: STONE_BUTTON, state: { facing: 'north', face: 'floor' }, property: 'powered' },
        { blockId: STONE_BUTTON, state: { facing: 'north', face: 'floor', powered: 1 }, property: 'powered' },
        { blockId: LEVER, state: {}, property: 'facing' },
        { blockId: LEVER, state: { facing: 'north' }, property: 'face' },
        { blockId: LEVER, state: { facing: 'north', face: 'side' }, property: 'face' },
        { blockId: LEVER, state: { facing: 'north', face: 'floor' }, property: 'powered' },
        { blockId: LEVER, state: { facing: 'north', face: 'floor', powered: 1 }, property: 'powered' },
        { blockId: REPEATER, state: {}, property: 'facing' },
        { blockId: REPEATER, state: { facing: 'north' }, property: 'delay' },
        { blockId: REPEATER, state: { facing: 'north', delay: 5 }, property: 'delay' },
        { blockId: REPEATER, state: { facing: 'north', delay: 1 }, property: 'locked' },
        { blockId: REPEATER, state: { facing: 'north', delay: 1, locked: 1 }, property: 'locked' },
        { blockId: RAIL, state: { shape: 'invalid' }, property: 'shape' },
        { blockId: REDSTONE_WIRE, state: {}, property: 'connections' },
        { blockId: REDSTONE_WIRE, state: { connections: { north: 'diagonal', east: 'none', south: 'none', west: 'none' } }, property: 'connections.north' },
        { blockId: REDSTONE_TORCH, state: { lit: 1 }, property: 'lit' },
        { blockId: REDSTONE_WALL_TORCH, state: { facing: 'up', lit: true }, property: 'facing' },
        { blockId: FARMLAND, state: { moisture: 8 }, property: 'moisture' },
        { blockId: FARMLAND, state: {}, property: 'moisture' },
        { blockId: CHEST, state: { facing: 'north', type: 'both' }, property: 'type' },
        { blockId: CHEST, state: { facing: 'north' }, property: 'type' },
        { blockId: ENDER_CHEST, state: { facing: 'up' }, property: 'facing' },
        { blockId: BED, state: { facing: 'north', part: 'side', occupied: false }, property: 'part' },
        { blockId: BED, state: {}, property: 'facing' },
        { blockId: BED, state: { facing: 'north' }, property: 'part' },
        { blockId: BED, state: { facing: 'north', part: 'foot' }, property: 'occupied' },
        { blockId: ANVIL, state: { facing: 'down' }, property: 'facing' },
        { blockId: WATER_CAULDRON, state: { level: 0 }, property: 'level' },
        { blockId: WATER_CAULDRON, state: {}, property: 'level' },
        { blockId: HOPPER, state: { facing: 'up', enabled: true }, property: 'facing' },
        { blockId: HOPPER, state: {}, property: 'facing' },
        { blockId: COMPARATOR, state: { facing: 'north', powered: false, mode: 'add' }, property: 'mode' },
        { blockId: COMPARATOR, state: {}, property: 'facing' },
        { blockId: COMPARATOR, state: { facing: 'north' }, property: 'powered' },
        { blockId: COMPARATOR, state: { facing: 'north', powered: false }, property: 'mode' },
        { blockId: BREWING_STAND, state: { has_bottle_0: true, has_bottle_1: 'false', has_bottle_2: false }, property: 'has_bottle_1' },
        { blockId: END_PORTAL_FRAME, state: { facing: 'north' }, property: 'eye' },
        { blockId: END_PORTAL_FRAME, state: {}, property: 'facing' },
        { blockId: END_ROD, state: { facing: 'sideways' }, property: 'facing' },
        { blockId: END_ROD, state: {}, property: 'facing' },
        { blockId: PISTON_HEAD, state: { facing: 'north', short: false, type: 'sticky-ish' }, property: 'type' },
        { blockId: PISTON_HEAD, state: {}, property: 'facing' },
        { blockId: PISTON_HEAD, state: { facing: 'north' }, property: 'short' },
        { blockId: PISTON_HEAD, state: { facing: 'north', short: false }, property: 'type' },
        { blockId: PISTON, state: { facing: 'sideways', extended: true }, property: 'facing' },
        { blockId: PISTON, state: { facing: 'north', extended: 'true' }, property: 'extended' },
        { blockId: NETHER_PORTAL, state: { axis: 'y' }, property: 'axis' },
        { blockId: NETHER_PORTAL, state: {}, property: 'axis' },
        { blockId: FIRE, state: { age: 0 }, property: 'connections' },
        { blockId: FIRE, state: {}, property: 'age' },
        { blockId: FIRE, state: { age: 0, connections: { north: 'side', east: false, south: false, west: false, up: false } }, property: 'connections.north' },
        { blockId: WITHER_SKELETON_SKULL, state: { powered: false, rotation: 16 }, property: 'rotation' },
        { blockId: WITHER_SKELETON_SKULL, state: {}, property: 'powered' },
        { blockId: WITHER_SKELETON_SKULL, state: { powered: false }, property: 'rotation' },
        { blockId: CHORUS_FLOWER, state: { age: 6 }, property: 'age' },
        { blockId: CHORUS_FLOWER, state: {}, property: 'age' },
        { blockId: CHORUS_PLANT, state: { connections: { down: false, north: 'side', east: false, south: false, west: false, up: false } }, property: 'connections.north' },
        { blockId: CHORUS_PLANT, state: {}, property: 'connections' },
      ]

      for (const { blockId, state, property } of invalidCases) {
        effectiveState = invalidFixture<EffectiveBlockStateValues>(state)
        const result = meshSpecials(
          lookup,
          chunkWithStates([[8, 64, 8, blockId]], [[8, 64, 8, 0]]),
          {},
          CHUNK_HEIGHT,
        )
        expect(result).toStrictEqual(Result.fail({
          _tag: 'InvalidBlockStateModelProperty',
          blockId,
          property,
        }))
      }

      FastCheck.assert(FastCheck.property(
        FastCheck.integer({ min: -64, max: 64 }).filter((moisture) => moisture < 0 || moisture > 7),
        (moisture) => {
          effectiveState = invalidFixture<EffectiveBlockStateValues>({ moisture })
          expect(meshSpecials(
            lookup,
            chunkWithStates([[8, 64, 8, FARMLAND]], [[8, 64, 8, 0]]),
            {},
            CHUNK_HEIGHT,
          )).toStrictEqual(Result.fail({
            _tag: 'InvalidBlockStateModelProperty',
            blockId: FARMLAND,
            property: 'moisture',
          }))
        },
      ))

      const invalidFacing = FastCheck.oneof(
        FastCheck.string().filter((facing) => !['north', 'east', 'south', 'west', 'up', 'down'].includes(facing)),
        FastCheck.integer(),
        FastCheck.boolean(),
        FastCheck.constant(null),
      )
      const facingCases = [
        { blockId: REDSTONE_WALL_TORCH, state: { lit: true } },
        { blockId: BED, state: { part: 'head', occupied: false } },
        { blockId: ANVIL, state: {} },
        { blockId: HOPPER, state: { enabled: true } },
        { blockId: CHEST, state: { type: 'single' } },
        { blockId: ENDER_CHEST, state: { waterlogged: false } },
        { blockId: END_PORTAL_FRAME, state: { eye: false } },
        { blockId: PISTON, state: { extended: true } },
        { blockId: STICKY_PISTON, state: { extended: false } },
      ] as const
      FastCheck.assert(FastCheck.property(invalidFacing, (facing) => {
        for (const { blockId, state } of facingCases) {
          effectiveState = invalidFixture<EffectiveBlockStateValues>({ ...state, facing })
          expect(meshSpecials(
            lookup,
            chunkWithStates([[8, 64, 8, blockId]], [[8, 64, 8, 0]]),
            {},
            CHUNK_HEIGHT,
            { min: [8, 64, 8], max: [9, 65, 9] },
          )).toStrictEqual(Result.fail({
            _tag: 'InvalidBlockStateModelProperty',
            blockId,
            property: 'facing',
          }))
        }
      }))
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

describe('adjacent special-block boundary visibility', () => {
  it.effect('matches fixed vanilla stair faces for adjacent directions, halves, and corner shapes', () =>
    Effect.sync(() => {
      // Literal east-face patches from the Java 1.21.4 oak_stairs blockstate and model boxes.
      // These coordinates are independent of the mesher's occupancy table.
      const eastFacePatches = {
        lowerNorth: [[1, 64, 0], [1, 64, 0.5], [1, 64.5, 0.5], [1, 64.5, 0]],
        lowerSouth: [[1, 64, 0.5], [1, 64, 1], [1, 64.5, 1], [1, 64.5, 0.5]],
        upperNorth: [[1, 64.5, 0], [1, 64.5, 0.5], [1, 65, 0.5], [1, 65, 0]],
        upperSouth: [[1, 64.5, 0.5], [1, 64.5, 1], [1, 65, 1], [1, 65, 0.5]],
      } as const satisfies Readonly<Record<string, ReadonlyArray<GeometryVertex>>>

      const cases = [
        { id: 'same-facing straight', neighbor: { facing: 'east', half: 'bottom', shape: 'straight' }, expected: ['upperNorth', 'upperSouth'] },
        { id: 'opposite-facing straight', neighbor: { facing: 'west', half: 'bottom', shape: 'straight' }, expected: [] },
        { id: 'upper neighbor', neighbor: { facing: 'east', half: 'top', shape: 'straight' }, expected: ['lowerNorth', 'lowerSouth'] },
        { id: 'inner-left neighbor', neighbor: { facing: 'east', half: 'bottom', shape: 'inner_left' }, expected: ['upperSouth'] },
        { id: 'inner-right neighbor', neighbor: { facing: 'east', half: 'bottom', shape: 'inner_right' }, expected: ['upperNorth'] },
        { id: 'outer-left neighbor', neighbor: { facing: 'east', half: 'bottom', shape: 'outer_left' }, expected: ['upperNorth', 'upperSouth'] },
        { id: 'outer-right neighbor', neighbor: { facing: 'east', half: 'bottom', shape: 'outer_right' }, expected: ['upperNorth', 'upperSouth'] },
        { id: 'opposite-facing inner-left neighbor', neighbor: { facing: 'west', half: 'bottom', shape: 'inner_left' }, expected: [] },
        { id: 'opposite-facing inner-right neighbor', neighbor: { facing: 'west', half: 'bottom', shape: 'inner_right' }, expected: [] },
        { id: 'opposite-facing outer-left neighbor', neighbor: { facing: 'west', half: 'bottom', shape: 'outer_left' }, expected: ['upperNorth'] },
        { id: 'opposite-facing outer-right neighbor', neighbor: { facing: 'west', half: 'bottom', shape: 'outer_right' }, expected: ['upperSouth'] },
      ] as const

      for (const testCase of cases) {
        const quads = Result.getOrThrow(meshSpecialBlocks(
          SPECIAL_LOOKUP,
          chunkWithStates(
            [[0, 64, 0, STAIRS], [1, 64, 0, STAIRS]],
            [
              [0, 64, 0, encodeState(STAIRS, { facing: 'east', half: 'bottom', shape: 'straight' })],
              [1, 64, 0, encodeState(STAIRS, testCase.neighbor)],
            ],
          ),
          {},
          CHUNK_HEIGHT,
        ))
        const actual = geometryFaceKeysOnPlane(
          quads.filter((quad) => quad.kind === 'stairs'),
          'xPos',
          0,
          1,
        )
        const expected = testCase.expected
          .map((patch) => geometryFaceKey('xPos', eastFacePatches[patch]))
          .sort()
        expect(actual, testCase.id).toStrictEqual(expected)
      }
    }),
  )

  it.effect('matches fixed vanilla stair faces against blocks above and below', () =>
    Effect.sync(() => {
      const anchor = encodeState(STAIRS, { facing: 'east', half: 'bottom', shape: 'straight' })
      const above = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[0, 64, 0, STAIRS], [0, 65, 0, STAIRS]],
          [
            [0, 64, 0, anchor],
            [0, 65, 0, encodeState(STAIRS, { facing: 'west', half: 'top', shape: 'straight' })],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))
      expect(geometryFaceKeysOnPlane(
        above.filter((quad) => quad.kind === 'stairs'),
        'yPos',
        1,
        65,
      )).toStrictEqual([
        geometryFaceKey('yPos', [[0.5, 65, 0], [1, 65, 0], [1, 65, 0.5], [0.5, 65, 0.5]]),
        geometryFaceKey('yPos', [[0.5, 65, 0.5], [1, 65, 0.5], [1, 65, 1], [0.5, 65, 1]]),
      ].sort())

      const below = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[0, 63, 0, STAIRS], [0, 64, 0, STAIRS]],
          [
            [0, 63, 0, encodeState(STAIRS, { facing: 'east', half: 'bottom', shape: 'straight' })],
            [0, 64, 0, anchor],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))
      expect(geometryFaceKeysOnPlane(
        below.filter((quad) => quad.kind === 'stairs'),
        'yNeg',
        1,
        64,
      )).toStrictEqual([
        geometryFaceKey('yNeg', [[0, 64, 0], [0.5, 64, 0], [0.5, 64, 0.5], [0, 64, 0.5]]),
        geometryFaceKey('yNeg', [[0, 64, 0.5], [0.5, 64, 0.5], [0.5, 64, 1], [0, 64, 1]]),
      ].sort())
    }),
  )

  it.effect('culls the shared cap between vertically adjacent cactus blocks', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([[8, 64, 8, CACTUS], [8, 65, 8, CACTUS]]),
        {},
        CHUNK_HEIGHT,
      ))
      const cactusQuads = quads.filter((quad) => quad.kind === 'cactus')

      expect(geometryFaceKeysOnPlane(cactusQuads, 'yPos', 1, 65)).toStrictEqual([])
      expect(geometryFaceKeysOnPlane(cactusQuads, 'yNeg', 1, 65)).toStrictEqual([])
    }),
  )

  it.effect('keeps the full snow-layer face when a shorter neighbor leaves any part exposed', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[8, 64, 8, SNOW], [9, 64, 8, SNOW]],
          [
            [8, 64, 8, encodeState(SNOW, { layers: 8 })],
            [9, 64, 8, encodeState(SNOW, { layers: 4 })],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))
      const snowQuads = quads.filter((quad) => quad.kind === 'snowLayer')

      expect(geometryFaceKeysOnPlane(snowQuads, 'xPos', 0, 9)).toStrictEqual([
        geometryFaceKey('xPos', [[9, 64, 9], [9, 64, 8], [9, 65, 8], [9, 65, 9]]),
      ])
      expect(geometryFaceKeysOnPlane(snowQuads, 'xNeg', 0, 9)).toStrictEqual([])
    }),
  )

  it.effect('removes the shared repeater-base face for adjacent unlocked repeaters', () =>
    Effect.sync(() => {
      const repeaterState = encodeState(REPEATER, { facing: 'east', delay: 1, locked: false })
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[8, 64, 8, REPEATER], [9, 64, 8, REPEATER]],
          [[8, 64, 8, repeaterState], [9, 64, 8, repeaterState]],
        ),
        {},
        CHUNK_HEIGHT,
      ))

      expect(geometryFaceKeysOnPlane(
        quads.filter((quad) => quad.blockId === REPEATER && quad.kind === 'repeater'),
        'xPos',
        0,
        9,
      )).toStrictEqual([])
    }),
  )

  it.effect('keeps an exposed locked-repeater marker beside a perpendicular locked repeater', () =>
    Effect.sync(() => {
      const eastFacingLock = encodeState(REPEATER, { facing: 'east', delay: 1, locked: true })
      const northLock = encodeState(REPEATER, { facing: 'north', delay: 1, locked: true })
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[8, 64, 8, REPEATER], [8, 64, 9, REPEATER]],
          [[8, 64, 8, eastFacingLock], [8, 64, 9, northLock]],
        ),
        {},
        CHUNK_HEIGHT,
      ))

      expect(geometryFaceKeysOnPlane(
        quads.filter((quad) => quad.blockId === REPEATER && quad.kind === 'repeater'),
        'zPos',
        2,
        9,
      )).toStrictEqual([
        geometryFaceKey('zPos', [[8 + 7 / 16, 64 + 1 / 8, 9], [8 + 9 / 16, 64 + 1 / 8, 9], [8 + 9 / 16, 64 + 1 / 4, 9], [8 + 7 / 16, 64 + 1 / 4, 9]]),
      ])
    }),
  )

  it.effect('clips matching stairs across the positive x chunk seam using translated geometry coordinates', () =>
    Effect.sync(() => {
      const state = encodeState(STAIRS, { facing: 'east', half: 'bottom', shape: 'straight' })
      const current = {
        ...chunkWithStates([[15, 64, 0, STAIRS]], [[15, 64, 0, state]]),
        coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
      }
      const xPos = {
        ...chunkWithStates([[0, 64, 0, STAIRS]], [[0, 64, 0, state]]),
        coord: chunkCoord(chunkAxis(1), chunkAxis(0)),
      }
      const quads = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, current, { xPos }, CHUNK_HEIGHT))

      expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'stairs'), 'xPos', 0, 16)).toStrictEqual([
        geometryFaceKey('xPos', [[16, 64.5, 0], [16, 64.5, 0.5], [16, 65, 0.5], [16, 65, 0]]),
        geometryFaceKey('xPos', [[16, 64.5, 0.5], [16, 64.5, 1], [16, 65, 1], [16, 65, 0.5]]),
      ].sort())
    }),
  )

  it.effect('clips matching stairs across the negative x chunk seam using translated geometry coordinates', () =>
    Effect.sync(() => {
      const state = encodeState(STAIRS, { facing: 'east', half: 'bottom', shape: 'straight' })
      const current = {
        ...chunkWithStates([[0, 64, 0, STAIRS]], [[0, 64, 0, state]]),
        coord: chunkCoord(chunkAxis(1), chunkAxis(0)),
      }
      const xNeg = {
        ...chunkWithStates([[15, 64, 0, STAIRS]], [[15, 64, 0, state]]),
        coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
      }
      const quads = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, current, { xNeg }, CHUNK_HEIGHT))

      expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'stairs'), 'xNeg', 0, 0)).toStrictEqual([])
    }),
  )

  it.effect('clips matching stairs across the positive z chunk seam using translated geometry coordinates', () =>
    Effect.sync(() => {
      const state = encodeState(STAIRS, { facing: 'south', half: 'bottom', shape: 'straight' })
      const current = {
        ...chunkWithStates([[0, 64, 15, STAIRS]], [[0, 64, 15, state]]),
        coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
      }
      const zPos = {
        ...chunkWithStates([[0, 64, 0, STAIRS]], [[0, 64, 0, state]]),
        coord: chunkCoord(chunkAxis(0), chunkAxis(1)),
      }
      const quads = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, current, { zPos }, CHUNK_HEIGHT))

      expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'stairs'), 'zPos', 2, 16)).toStrictEqual([
        geometryFaceKey('zPos', [[0, 64.5, 16], [0.5, 64.5, 16], [0.5, 65, 16], [0, 65, 16]]),
        geometryFaceKey('zPos', [[0.5, 64.5, 16], [1, 64.5, 16], [1, 65, 16], [0.5, 65, 16]]),
      ].sort())
    }),
  )

  it.effect('clips matching stairs across the negative z chunk seam using translated geometry coordinates', () =>
    Effect.sync(() => {
      const state = encodeState(STAIRS, { facing: 'south', half: 'bottom', shape: 'straight' })
      const current = {
        ...chunkWithStates([[0, 64, 0, STAIRS]], [[0, 64, 0, state]]),
        coord: chunkCoord(chunkAxis(0), chunkAxis(1)),
      }
      const zNeg = {
        ...chunkWithStates([[0, 64, 15, STAIRS]], [[0, 64, 15, state]]),
        coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
      }
      const quads = Result.getOrThrow(meshSpecialBlocks(SPECIAL_LOOKUP, current, { zNeg }, CHUNK_HEIGHT))

      expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'stairs'), 'zNeg', 2, 0)).toStrictEqual([])
    }),
  )

  it.effect('keeps slab faces beside configured unknown ids only for configured non-opaque neighbor kinds', () =>
    Effect.sync(() => {
      const customBlockId = Result.getOrThrow(KernelBlockId.result(300))
      const chunk = chunkWithStates(
        [[0, 64, 0, SLAB], [1, 64, 0, customBlockId]],
        [[0, 64, 0, encodeState(SLAB, { type: 'bottom' })]],
      )
      const expectedFace = [
        geometryFaceKey('xPos', [[1, 64, 0], [1, 64, 1], [1, 64.5, 1], [1, 64.5, 0]]),
      ]
      const cases = [
        {
          id: 'cross-plant configuration keeps the face',
          config: { ...MESH_CONFIG, crossPlantBlockIds: new Set([customBlockId]) },
          expected: expectedFace,
        },
        {
          id: 'transparent-solid configuration keeps the face',
          config: { ...MESH_CONFIG, transparentSolidBlockIds: new Set([customBlockId]) },
          expected: expectedFace,
        },
        {
          id: 'water configuration keeps the face',
          config: { ...MESH_CONFIG, waterBlockIds: new Set([customBlockId]) },
          expected: expectedFace,
        },
        {
          id: 'fluid-only configuration culls the face',
          config: { ...MESH_CONFIG, fluidMaxLevels: new Map([[customBlockId, 8]]) },
          expected: [],
        },
      ] as const

      for (const testCase of cases) {
        const quads = Result.getOrThrow(meshSpecialBlocks(
          SPECIAL_LOOKUP,
          chunk,
          {},
          CHUNK_HEIGHT,
          { min: [0, 0, 0], max: [16, CHUNK_HEIGHT, 16] },
          testCase.config,
        ))
        expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'slab'), 'xPos', 0, 1), testCase.id)
          .toStrictEqual(testCase.expected)
      }
    }),
  )

  it.effect('propagates an invalid encoded state from an adjacent stair as a typed failure', () =>
    Effect.sync(() => {
      const anchorState = encodeState(STAIRS, { facing: 'east', half: 'bottom', shape: 'straight' })
      const invalidEncodedState = 0xFFFFFFFF
      const chunk = chunkWithStates(
        [[0, 64, 0, STAIRS], [1, 64, 0, STAIRS]],
        [[0, 64, 0, anchorState], [1, 64, 0, invalidEncodedState]],
      )

      expect(meshSpecialBlocks(SPECIAL_LOOKUP, chunk, {}, CHUNK_HEIGHT)).toStrictEqual(Result.fail({
        _tag: 'ChunkBlockStateCodecFailure',
        blockId: STAIRS,
        encoded: invalidEncodedState,
        index: blockIndex(1, 64, 0, CHUNK_HEIGHT),
        reason: 'reserved-code',
      }))
    }),
  )

  it.effect('clips adjacent ladders with each valid neighbor facing', () =>
    Effect.sync(() => {
      // Constructed chunk-input pair; attachment support blocks are omitted.
      const fullFace = geometryFaceKey('xPos', [[1, 64, 0], [1, 64, 1], [1, 65, 1], [1, 65, 0]])
      const cases = [
        { id: 'west-facing neighbor covers the face', facing: 'west', expected: [] },
        { id: 'east-facing neighbor misses the face', facing: 'east', expected: [fullFace] },
        {
          id: 'north-facing neighbor covers its north strip',
          facing: 'north',
          expected: [geometryFaceKey('xPos', [[1, 64, 1 / 16], [1, 64, 1], [1, 65, 1], [1, 65, 1 / 16]])],
        },
        {
          id: 'south-facing neighbor covers its south strip',
          facing: 'south',
          expected: [geometryFaceKey('xPos', [[1, 64, 0], [1, 64, 15 / 16], [1, 65, 15 / 16], [1, 65, 0]])],
        },
      ] as const

      for (const testCase of cases) {
        const quads = Result.getOrThrow(meshSpecialBlocks(
          SPECIAL_LOOKUP,
          chunkWithStates(
            [[0, 64, 0, LADDER], [1, 64, 0, LADDER]],
            [
              [0, 64, 0, encodeState(LADDER, { facing: 'east' })],
              [1, 64, 0, encodeState(LADDER, { facing: testCase.facing })],
            ],
          ),
          {},
          CHUNK_HEIGHT,
        ))
        expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'ladder'), 'xPos', 0, 1), testCase.id)
          .toStrictEqual(testCase.expected)
      }
    }),
  )

  it.effect('uses neighboring button geometry for all mount faces and wall facings', () =>
    Effect.sync(() => {
      // Constructed chunk-input pair; attachment support blocks are omitted.
      const fullFace = geometryFaceKey('xPos', [
        [1, 64 + 6 / 16, 6 / 16], [1, 64 + 10 / 16, 6 / 16],
        [1, 64 + 10 / 16, 10 / 16], [1, 64 + 6 / 16, 10 / 16],
      ])
      const cases = [
        { id: 'west wall button covers the interface', neighbor: { facing: 'west', face: 'wall', powered: false }, expected: [] },
        { id: 'pressed west wall button covers the interface', neighbor: { facing: 'west', face: 'wall', powered: true }, expected: [] },
        { id: 'east wall button misses the interface', neighbor: { facing: 'east', face: 'wall', powered: false }, expected: [fullFace] },
        { id: 'north wall button misses the interface', neighbor: { facing: 'north', face: 'wall', powered: false }, expected: [fullFace] },
        { id: 'south wall button misses the interface', neighbor: { facing: 'south', face: 'wall', powered: false }, expected: [fullFace] },
        { id: 'floor button misses the interface', neighbor: { facing: 'west', face: 'floor', powered: false }, expected: [fullFace] },
        { id: 'ceiling button misses the interface', neighbor: { facing: 'east', face: 'ceiling', powered: true }, expected: [fullFace] },
      ] as const

      for (const testCase of cases) {
        const quads = Result.getOrThrow(meshSpecialBlocks(
          SPECIAL_LOOKUP,
          chunkWithStates(
            [[0, 64, 0, STONE_BUTTON], [1, 64, 0, STONE_BUTTON]],
            [
              [0, 64, 0, encodeState(STONE_BUTTON, { facing: 'east', face: 'wall', powered: false })],
              [1, 64, 0, encodeState(STONE_BUTTON, testCase.neighbor)],
            ],
          ),
          {},
          CHUNK_HEIGHT,
        ))
        expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'stoneButton'), 'xPos', 0, 1), testCase.id)
          .toStrictEqual(testCase.expected)
      }
    }),
  )

  it.effect('uses neighboring lever geometry for all mount faces and horizontal facings', () =>
    Effect.sync(() => {
      // Constructed chunk-input pair; attachment support blocks are omitted.
      const fullFace = geometryFaceKey('xPos', [
        [1, 64 + 6 / 16, 6 / 16], [1, 64 + 6 / 16, 10 / 16],
        [1, 64 + 10 / 16, 10 / 16], [1, 64 + 10 / 16, 6 / 16],
      ])
      const cases = [
        { id: 'west wall lever covers the interface', neighbor: { facing: 'west', face: 'wall', powered: false }, expected: [] },
        { id: 'powered west wall lever covers the interface', neighbor: { facing: 'west', face: 'wall', powered: true }, expected: [] },
        { id: 'east wall lever misses the interface', neighbor: { facing: 'east', face: 'wall', powered: false }, expected: [fullFace] },
        { id: 'north wall lever misses the interface', neighbor: { facing: 'north', face: 'wall', powered: false }, expected: [fullFace] },
        { id: 'south wall lever misses the interface', neighbor: { facing: 'south', face: 'wall', powered: false }, expected: [fullFace] },
        { id: 'west floor lever misses the interface', neighbor: { facing: 'west', face: 'floor', powered: false }, expected: [fullFace] },
        { id: 'east floor lever misses the interface', neighbor: { facing: 'east', face: 'floor', powered: true }, expected: [fullFace] },
        { id: 'north floor lever misses the interface', neighbor: { facing: 'north', face: 'floor', powered: false }, expected: [fullFace] },
        { id: 'south floor lever misses the interface', neighbor: { facing: 'south', face: 'floor', powered: true }, expected: [fullFace] },
        { id: 'west ceiling lever misses the interface', neighbor: { facing: 'west', face: 'ceiling', powered: false }, expected: [fullFace] },
        { id: 'east ceiling lever misses the interface', neighbor: { facing: 'east', face: 'ceiling', powered: true }, expected: [fullFace] },
        { id: 'north ceiling lever misses the interface', neighbor: { facing: 'north', face: 'ceiling', powered: false }, expected: [fullFace] },
        { id: 'south ceiling lever misses the interface', neighbor: { facing: 'south', face: 'ceiling', powered: true }, expected: [fullFace] },
      ] as const

      for (const testCase of cases) {
        const quads = Result.getOrThrow(meshSpecialBlocks(
          SPECIAL_LOOKUP,
          chunkWithStates(
            [[0, 64, 0, LEVER], [1, 64, 0, LEVER]],
            [
              [0, 64, 0, encodeState(LEVER, { facing: 'east', face: 'wall', powered: false })],
              [1, 64, 0, encodeState(LEVER, testCase.neighbor)],
            ],
          ),
          {},
          CHUNK_HEIGHT,
        ))
        expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'lever'), 'xPos', 0, 1), testCase.id)
          .toStrictEqual(testCase.expected)
      }
    }),
  )

  it.effect('keeps only the non-overlapping halves between adjacent bottom and top slabs', () =>
    Effect.sync(() => {
      const matchingSlabs = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[0, 64, 0, SLAB], [1, 64, 0, SLAB]],
          [
            [0, 64, 0, encodeState(SLAB, { type: 'bottom' })],
            [1, 64, 0, encodeState(SLAB, { type: 'bottom' })],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))
      const matchingSlabQuads = matchingSlabs.filter((quad) => quad.kind === 'slab')
      expect(geometryFaceKeysOnPlane(matchingSlabQuads, 'xPos', 0, 1)).toStrictEqual([])
      expect(geometryFaceKeysOnPlane(matchingSlabQuads, 'xNeg', 0, 1)).toStrictEqual([])

      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[0, 64, 0, SLAB], [1, 64, 0, SLAB]],
          [
            [0, 64, 0, encodeState(SLAB, { type: 'bottom' })],
            [1, 64, 0, encodeState(SLAB, { type: 'top' })],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))
      const slabQuads = quads.filter((quad) => quad.kind === 'slab')

      expect(geometryFaceKeysOnPlane(slabQuads, 'xPos', 0, 1)).toStrictEqual([
        geometryFaceKey('xPos', [[1, 64, 0], [1, 64, 1], [1, 64.5, 1], [1, 64.5, 0]]),
      ])
      expect(geometryFaceKeysOnPlane(slabQuads, 'xNeg', 0, 1)).toStrictEqual([
        geometryFaceKey('xNeg', [[1, 64.5, 0], [1, 64.5, 1], [1, 65, 1], [1, 65, 0]]),
      ])
    }),
  )

  it.effect('preserves the exposed part of perpendicular closed-door panels', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [[0, 64, 0, DOOR], [0, 64, 1, DOOR]],
          [
            [0, 64, 0, encodeState(DOOR, { facing: 'north', hinge: 'left', half: 'lower', open: false })],
            [0, 64, 1, encodeState(DOOR, { facing: 'west', hinge: 'left', half: 'lower', open: false })],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))
      const doorQuads = quads.filter((quad) => quad.kind === 'door')

      expect(geometryFaceKeysOnPlane(doorQuads, 'zPos', 2, 1)).toStrictEqual([
        geometryFaceKey('zPos', [[0, 64, 1], [13 / 16, 64, 1], [13 / 16, 65, 1], [0, 65, 1]]),
      ])
    }),
  )

  it.effect('keeps the inset side faces of adjacent cacti in constructed chunk input', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWith([[0, 64, 0, CACTUS], [1, 64, 0, CACTUS]]),
        {},
        CHUNK_HEIGHT,
      ))
      const cactusQuads = quads.filter((quad) => quad.kind === 'cactus')

      expect(geometryFaceKeysOnPlane(cactusQuads, 'xPos', 0, 15 / 16)).toStrictEqual([
        geometryFaceKey('xPos', [[15 / 16, 64, 1 / 16], [15 / 16, 64, 15 / 16], [15 / 16, 65, 15 / 16], [15 / 16, 65, 1 / 16]]),
      ])
      expect(geometryFaceKeysOnPlane(cactusQuads, 'xNeg', 0, 17 / 16)).toStrictEqual([
        geometryFaceKey('xNeg', [[17 / 16, 64, 1 / 16], [17 / 16, 64, 15 / 16], [17 / 16, 65, 15 / 16], [17 / 16, 65, 1 / 16]]),
      ])
    }),
  )

  it.effect('uses neighboring attachment geometry for ladders, buttons, and levers', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [
            [0, 64, 1, LADDER], [1, 64, 1, LADDER],
            [2, 64, 1, STONE_BUTTON], [3, 64, 1, STONE_BUTTON],
            [4, 64, 1, LEVER], [5, 64, 1, LEVER],
          ],
          [
            [0, 64, 1, encodeState(LADDER, { facing: 'west' })],
            [1, 64, 1, encodeState(LADDER, { facing: 'north' })],
            [2, 64, 1, encodeState(STONE_BUTTON, { facing: 'west', face: 'floor', powered: false })],
            [3, 64, 1, encodeState(STONE_BUTTON, { facing: 'west', face: 'wall', powered: false })],
            [4, 64, 1, encodeState(LEVER, { facing: 'west', face: 'floor', powered: false })],
            [5, 64, 1, encodeState(LEVER, { facing: 'west', face: 'wall', powered: false })],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))

      expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'ladder'), 'xNeg', 0, 1)).toStrictEqual([
        geometryFaceKey('xNeg', [[1, 64, 1], [1, 64, 1 + 1 / 16], [1, 65, 1 + 1 / 16], [1, 65, 1]]),
      ])
      expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'stoneButton'), 'xNeg', 0, 3)).toStrictEqual([
        geometryFaceKey('xNeg', [[3, 64 + 6 / 16, 1 + 6 / 16], [3, 64 + 6 / 16, 1 + 10 / 16], [3, 64 + 10 / 16, 1 + 10 / 16], [3, 64 + 10 / 16, 1 + 6 / 16]]),
      ])
      expect(geometryFaceKeysOnPlane(quads.filter((quad) => quad.kind === 'lever'), 'xNeg', 0, 5)).toStrictEqual([
        geometryFaceKey('xNeg', [[5, 64 + 6 / 16, 1 + 6 / 16], [5, 64 + 6 / 16, 1 + 10 / 16], [5, 64 + 10 / 16, 1 + 10 / 16], [5, 64 + 10 / 16, 1 + 6 / 16]]),
      ])
    }),
  )

  it.effect('keeps exposed vertical bases and interior rail and lily-pad planes', () =>
    Effect.sync(() => {
      const quads = Result.getOrThrow(meshSpecialBlocks(
        SPECIAL_LOOKUP,
        chunkWithStates(
          [
            [1, 64, 1, PRESSURE_PLATE], [1, 65, 1, PRESSURE_PLATE],
            [3, 64, 1, REPEATER], [3, 65, 1, REPEATER],
            [5, 64, 1, RAIL], [5, 65, 1, RAIL],
            [7, 64, 1, LILY_PAD], [7, 65, 1, LILY_PAD],
          ],
          [
            [1, 64, 1, encodeState(PRESSURE_PLATE, { powered: false })],
            [1, 65, 1, encodeState(PRESSURE_PLATE, { powered: false })],
            [3, 64, 1, encodeState(REPEATER, { facing: 'north', delay: 1, locked: false })],
            [3, 65, 1, encodeState(REPEATER, { facing: 'north', delay: 1, locked: false })],
            [5, 64, 1, encodeState(RAIL, { shape: 'north_south' })],
            [5, 65, 1, encodeState(RAIL, { shape: 'north_south' })],
          ],
        ),
        {},
        CHUNK_HEIGHT,
      ))
      const pressurePlateQuads = quads.filter((quad) => quad.kind === 'pressurePlate')
      const repeaterQuads = quads.filter((quad) => quad.kind === 'repeater')
      const lowerRailTop = quads.filter((quad) => quad.kind === 'rail' && quad.role === 'top' && quad.vertices.every(([, y]) => y === 64 + 1 / 16))
      const lowerLilyPadTop = quads.filter((quad) => quad.kind === 'lilyPad' && quad.vertices.every(([, y]) => y === 64 + 1 / 64))

      expect(geometryFaceKeysOnPlane(pressurePlateQuads, 'yNeg', 1, 65)).toStrictEqual([
        geometryFaceKey('yNeg', [[1 + 1 / 16, 65, 1 + 1 / 16], [2 - 1 / 16, 65, 1 + 1 / 16], [2 - 1 / 16, 65, 2 - 1 / 16], [1 + 1 / 16, 65, 2 - 1 / 16]]),
      ])
      expect(geometryFaceKeysOnPlane(repeaterQuads, 'yNeg', 1, 65)).toStrictEqual([
        geometryFaceKey('yNeg', [[3, 65, 1], [4, 65, 1], [4, 65, 2], [3, 65, 2]]),
      ])
      expect(lowerRailTop).toHaveLength(1)
      expect(lowerLilyPadTop).toHaveLength(1)
      expect(lowerLilyPadTop.map((quad) => geometryFaceKey('yPos', quad.vertices))).toStrictEqual([
        geometryFaceKey('yPos', [[7 + 1 / 16, 64 + 1 / 64, 2 - 1 / 16], [8 - 1 / 16, 64 + 1 / 64, 2 - 1 / 16], [8 - 1 / 16, 64 + 1 / 64, 1 + 1 / 16], [7 + 1 / 16, 64 + 1 / 64, 1 + 1 / 16]]),
      ])
    }),
  )
})
