import { describe, expect, it } from 'vitest'
import { Option, Result } from 'effect'
import { blockIdOf, encodeBlockState } from '@nerima-games/mc-kernel'
import { AO_MAX } from '../src/domain/ambient-occlusion.js'
import { MAX_BLOCK_ID } from '../src/domain/block-data.js'
import { blockIndex as indexOfBlock, emptyChunk } from '../src/domain/chunk-view.js'
import { faceCellAo, faceCellBlockId, meshAllFaces, packFaceCell } from '../src/domain/mesh-greedy.js'
import { meshChunk } from '../src/domain/mesh.js'
import { EMPTY_MESH_CONFIG } from '../src/domain/opacity.js'
import { totalQuadCount } from '../src/domain/mesh-types.js'
import { layerLookupFromTable } from '../src/domain/mesh-support.js'
import { SPECIAL_BLOCK_LOOKUP } from '../src/domain/special-mesh.js'
import { CONFIG as BENCH_CONFIG, LAKE } from '../scripts/bench-fixtures.js'

describe('greedy face expansion', () => {
  it('returns the first out-of-range mask index instead of expanding from a short work buffer', () => {
    const result = meshAllFaces({
      chunk: Result.getOrThrow(emptyChunk(2)),
      fluids: new Uint16Array(MAX_BLOCK_ID + 1),
      lookup: Result.getOrThrow(layerLookupFromTable(new Uint8Array(MAX_BLOCK_ID + 1))),
      light: { block: new Uint16Array(1), sky: new Uint16Array(1) },
      mask: new Uint32Array(1),
      neighbours: {},
      plants: new Uint8Array(MAX_BLOCK_ID + 1),
      specialLookup: Result.getOrThrow(SPECIAL_BLOCK_LOOKUP),
      push: (quad) => quad,
      yLimit: 2,
    })

    expect(result).toStrictEqual(Result.fail({ _tag: 'GreedyMaskIndexOutOfRange', index: 1 }))
  })
})

describe('packed face cells', () => {
  it('keeps the full 16-bit block id below ambient-occlusion bits', () => {
    const packed = packFaceCell(MAX_BLOCK_ID, AO_MAX)

    expect(faceCellBlockId(packed)).toBe(MAX_BLOCK_ID)
    expect(faceCellAo(packed)).toBe(AO_MAX)
  })
})

describe('greedy model-state merging', () => {
  it('merges adjacent opaque cells with equal state and preserves different states', () => {
    const logId = Option.getOrThrow(blockIdOf('oak_log'))
    const chunkWithLogAxes = (lowerAxis: 'x' | 'y' | 'z', upperAxis: 'x' | 'y' | 'z') => {
      const empty = Result.getOrThrow(emptyChunk(4))
      const blocks = new Uint16Array(empty.blocks)
      const blockStates = new Uint32Array(blocks.length)
      const lowerIndex = indexOfBlock(1, 1, 1, empty.height)
      const upperIndex = indexOfBlock(1, 2, 1, empty.height)
      blocks[lowerIndex] = logId
      blocks[upperIndex] = logId
      blockStates[lowerIndex] = Result.getOrThrow(encodeBlockState(logId, { axis: lowerAxis }))
      blockStates[upperIndex] = Result.getOrThrow(encodeBlockState(logId, { axis: upperAxis }))
      return { ...empty, blocks, blockStates }
    }
    const zFacesOf = (lowerAxis: 'x' | 'y' | 'z', upperAxis: 'x' | 'y' | 'z') =>
      Result.getOrThrow(meshChunk(chunkWithLogAxes(lowerAxis, upperAxis), {}, EMPTY_MESH_CONFIG))
        .opaque.filter((quad) => quad.direction === 'zPos')

    const equalStateFaces = zFacesOf('x', 'x')
    expect(equalStateFaces).toHaveLength(1)
    expect(equalStateFaces[0]).toMatchObject({
      blockState: { axis: 'x' },
      height: 2,
      lx: 1,
      lz: 1,
      width: 1,
      y: 1,
    })

    const differentStateFaces = zFacesOf('x', 'z')
    expect(differentStateFaces).toHaveLength(2)
    expect(
      differentStateFaces
        .map((quad) => ({
          axis: quad.blockState?.axis,
          height: quad.height,
          lx: quad.lx,
          lz: quad.lz,
          width: quad.width,
          y: quad.y,
        }))
        .sort((left, right) => left.y - right.y),
    ).toStrictEqual([
      { axis: 'x', height: 1, lx: 1, lz: 1, width: 1, y: 1 },
      { axis: 'z', height: 1, lx: 1, lz: 1, width: 1, y: 2 },
    ])
  })

  it('keeps equal model states separate when block or sky light differs along either merge axis', () => {
    const logId = Option.getOrThrow(blockIdOf('oak_log'))
    const chunkWithLightVariation = (
      cells: ReadonlyArray<readonly [number, number, number]>,
      lightDiffersAt: (lx: number, lz: number) => boolean,
      channel: 'block' | 'sky',
    ) => {
      const empty = Result.getOrThrow(emptyChunk(4))
      const blocks = new Uint16Array(empty.blocks)
      const blockStates = new Uint32Array(blocks.length)
      const blockLight = new Uint8Array(blocks.length).fill(9)
      const skyLight = new Uint8Array(blocks.length).fill(13)
      for (let lx = 0; lx < 16; lx += 1) {
        for (let lz = 0; lz < 16; lz += 1) {
          if (lightDiffersAt(lx, lz)) {
            for (let y = 0; y < empty.height; y += 1) {
              const index = indexOfBlock(lx, y, lz, empty.height)
              if (channel === 'block') {
                blockLight[index] = 2
              } else {
                skyLight[index] = 2
              }
            }
          }
        }
      }
      const encoded = Result.getOrThrow(encodeBlockState(logId, { axis: 'x' }))
      for (const [lx, y, lz] of cells) {
        const index = indexOfBlock(lx, y, lz, empty.height)
        blocks[index] = logId
        blockStates[index] = encoded
      }
      return { ...empty, blocks, blockStates, light: { blockLight, skyLight } }
    }
    const chunks = [
      chunkWithLightVariation([[2, 1, 4], [3, 1, 4]], (lx) => lx === 2, 'block'),
      chunkWithLightVariation([[2, 1, 4], [2, 1, 5]], (_lx, lz) => lz === 4, 'block'),
      chunkWithLightVariation([[2, 1, 4], [3, 1, 4]], (lx) => lx === 2, 'sky'),
      chunkWithLightVariation([[2, 1, 4], [2, 1, 5]], (_lx, lz) => lz === 4, 'sky'),
    ]

    for (const chunk of chunks) {
      const topFaces = Result.getOrThrow(meshChunk(chunk, {}, EMPTY_MESH_CONFIG)).opaque
        .filter((quad) => quad.direction === 'yPos')
      expect(topFaces).toHaveLength(2)
      expect(topFaces.every((quad) => quad.blockState?.axis === 'x')).toBe(true)
      expect(topFaces[0]?.light).not.toStrictEqual(topFaces[1]?.light)
    }
  })
})

describe('transparent block state failures', () => {
  it('returns a typed codec failure for malformed explicit glass state', () => {
    const glassId = Option.getOrThrow(blockIdOf('glass'))
    const empty = Result.getOrThrow(emptyChunk(4))
    const blocks = new Uint16Array(empty.blocks)
    const blockStates = new Uint32Array(blocks.length)
    const index = indexOfBlock(1, 1, 1, empty.height)
    blocks[index] = glassId
    blockStates[index] = 0xffff_ffff
    const chunk = { ...empty, blocks, blockStates }
    const config = {
      ...EMPTY_MESH_CONFIG,
      transparentSolidBlockIds: new Set([glassId]),
    }

    expect(meshChunk(chunk, {}, config)).toStrictEqual(Result.fail({
      _tag: 'ChunkBlockStateCodecFailure',
      blockId: glassId,
      encoded: 0xffff_ffff,
      index,
      reason: 'reserved-code',
    }))
  })
})

describe('benchmark cube workload', () => {
  it('keeps the lake-as-cubes quad count deterministic', () => {
    const layers = Result.getOrThrow(meshChunk(LAKE, {}, BENCH_CONFIG))

    expect(LAKE.blockStates).toBeUndefined()
    expect(LAKE.fluid).toBeDefined()
    expect(layers.fluids).toHaveLength(0)
    expect(layers.water.length).toBeGreaterThan(0)
    expect(totalQuadCount(layers)).toBe(1229)
  })
})
