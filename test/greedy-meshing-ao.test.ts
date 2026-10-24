import { describe, expect, it } from './effect-test.js'
import { Effect, Option, Result } from 'effect'
import { ChunkAxis, blockIdOf, chunkCoord } from '@nerima-games/mc-kernel'
import { AO_NONE } from '../src/domain/ambient-occlusion'
import { BLOCKS_PER_CHUNK, CHUNK_HEIGHT, type ChunkView, blockIndex } from '../src/domain/chunk-view'
import { FACE_DIRECTIONS, type QuadAxis, faceOf, tangentAxes } from '../src/domain/faces'
import { meshChunk } from '../src/domain/mesh'
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
})
