import { describe, expect, it } from './effect-test.js'
import { Effect, Option, Result } from 'effect'
import { ChunkAxis, blockIdOf, chunkCoord } from '@nerima-games/mc-kernel'
import { AO_NONE } from '../src/domain/ambient-occlusion'
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, type ChunkView, blockIndex } from '../src/domain/chunk-view'
import { FACE_DIRECTIONS, type QuadAxis, faceOf, tangentAxes } from '../src/domain/faces'
import { meshChunk, meshChunkRegion } from '../src/domain/mesh'
import type { MeshRegion } from '../src/domain/mesh-types'
import { EMPTY_MESH_CONFIG } from '../src/domain/opacity'

type Position = readonly [x: number, y: number, z: number]

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(`Unexpected Result failure: ${JSON.stringify(result.failure)}`)
  }
  return result.success
}

const STONE = Option.getOrThrow(blockIdOf('stone'))
const ORIGIN_AXIS = Result.getOrThrow(ChunkAxis.result(0))

const unitOn = (axis: QuadAxis): Position => {
  if (axis === 'x') {
    return [1, 0, 0]
  }
  if (axis === 'y') {
    return [0, 1, 0]
  }
  return [0, 0, 1]
}

const offsetBy = (position: Position, offset: Position): Position => [
  position[0] + offset[0],
  position[1] + offset[1],
  position[2] + offset[2],
]

const chunkWith = (cells: ReadonlyArray<Position>): ChunkView => {
  const blocks = new Uint16Array(BLOCKS_PER_CHUNK)
  for (const [lx, y, lz] of cells) {
    blocks[blockIndex(lx, y, lz, CHUNK_HEIGHT)] = STONE
  }
  return { blocks, coord: chunkCoord(ORIGIN_AXIS, ORIGIN_AXIS), height: CHUNK_HEIGHT }
}

const positionKey = (position: Position): string => position.join(',')

const regionOf = (positions: ReadonlyArray<Position>): MeshRegion => {
  const xs = positions.map(([x]) => x)
  const ys = positions.map(([, y]) => y)
  const zs = positions.map(([, , z]) => z)
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs) + 1, Math.max(...ys) + 1, Math.max(...zs) + 1],
  }
}

const quadCells = (quad: { direction: (typeof FACE_DIRECTIONS)[number]; lx: number; y: number; lz: number; width: number; height: number }): ReadonlyArray<Position> => {
  const [widthAxis, heightAxis] = tangentAxes(quad.direction)
  const origin: Position = [quad.lx, quad.y, quad.lz]
  const cells: Array<Position> = []
  for (let alongHeight = 0; alongHeight < quad.height; alongHeight += 1) {
    for (let alongWidth = 0; alongWidth < quad.width; alongWidth += 1) {
      const offsetOn = (axis: QuadAxis): number =>
        axis === widthAxis ? alongWidth : axis === heightAxis ? alongHeight : 0
      const offset: Position = [
        offsetOn('x'),
        offsetOn('y'),
        offsetOn('z'),
      ]
      cells.push(offsetBy(origin, offset))
    }
  }
  return cells
}

const inside = (region: MeshRegion, [x, y, z]: Position): boolean =>
  x >= region.min[0] && x < region.max[0] &&
  y >= region.min[1] && y < region.max[1] &&
  z >= region.min[2] && z < region.max[2]

describe('greedy meshing ambient occlusion', () => {
  it.effect('uses one AO value per face in all six directions and splits different values', () =>
    Effect.sync(() => {
      for (const direction of FACE_DIRECTIONS) {
        const [widthAxis, heightAxis] = tangentAxes(direction)
        const first: Position = [8, 64, 8]
        const second = offsetBy(first, unitOn(widthAxis))
        const face = faceOf(direction)
        const normal: Position = [face.nx, face.ny, face.nz]
        const blocker = offsetBy(offsetBy(first, normal), unitOn(heightAxis))
        const cellKeys = new Set([positionKey(first), positionKey(second)])

        const unoccluded = expectSuccess(meshChunk(chunkWith([first, second]), {}, EMPTY_MESH_CONFIG))
        const merged = unoccluded.opaque.filter(
          (quad) => quad.direction === direction && cellKeys.has(positionKey([quad.lx, quad.y, quad.lz])),
        )
        expect(merged).toHaveLength(1)
        expect(merged[0]).toMatchObject({ width: 2, height: 1, ao: AO_NONE })

        const shaded = expectSuccess(meshChunk(chunkWith([first, second, blocker]), {}, EMPTY_MESH_CONFIG))
        const split = shaded.opaque.filter(
          (quad) => quad.direction === direction && cellKeys.has(positionKey([quad.lx, quad.y, quad.lz])),
        )
        const aoByCell = new Map(split.map((quad) => [positionKey([quad.lx, quad.y, quad.lz]), quad.ao]))

        expect(split).toHaveLength(2)
        expect(split.every((quad) => quad.width === 1 && quad.height === 1)).toBe(true)
        expect(aoByCell.get(positionKey(first))).toBe(AO_NONE + 1)
        expect(aoByCell.get(positionKey(second))).toBe(AO_NONE)
      }
    }),
  )

  it.effect('uses halo blockers for AO without emitting their faces outside the dirty region', () =>
    Effect.sync(() => {
      for (const direction of FACE_DIRECTIONS) {
        const [widthAxis, heightAxis] = tangentAxes(direction)
        const first: Position = [8, 64, 8]
        const second = offsetBy(first, unitOn(widthAxis))
        const face = faceOf(direction)
        const normal: Position = [face.nx, face.ny, face.nz]
        const blocker = offsetBy(offsetBy(first, normal), unitOn(heightAxis))
        const region = regionOf([first, second])
        const cellKeys = new Set([positionKey(first), positionKey(second)])

        const regional = expectSuccess(
          meshChunkRegion(chunkWith([first, second, blocker]), {}, EMPTY_MESH_CONFIG, region),
        )
        const split = regional.layers.opaque.filter(
          (quad) => quad.direction === direction && cellKeys.has(positionKey([quad.lx, quad.y, quad.lz])),
        )
        const aoByCell = new Map(split.map((quad) => [positionKey([quad.lx, quad.y, quad.lz]), quad.ao]))

        expect(regional.ownedRegion).toStrictEqual(region)
        expect(split).toHaveLength(2)
        expect(aoByCell.get(positionKey(first))).toBe(AO_NONE + 1)
        expect(aoByCell.get(positionKey(second))).toBe(AO_NONE)
        expect(regional.layers.opaque.every((quad) => quadCells(quad).every((cell) => inside(region, cell)))).toBe(true)
      }
    }),
  )
})
