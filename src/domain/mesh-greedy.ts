import { Brand } from 'effect'
import { AIR, type BlockId, MAX_BLOCK_ID, blockIdAt } from './block-data.js'
import {
  CHUNK_SIZE,
  type ChunkNeighbours,
  type ChunkView,
  getBlockAcrossBoundary,
} from './chunk-view.js'
import { FACES, type Face, type FacePlacement, facePlacementOf } from './faces.js'
import {
  FIRST_INDEX,
  STEP,
  isFaceExposed,
  layerAt,
} from './mesh-support.js'
import { MESH_LAYERS } from './opacity.js'
import type { Quad } from './mesh-types.js'
import type { QuadLight } from './light-types.js'
import { ambientOcclusionAt } from './ambient-occlusion.js'
import { isCrossPlant } from './plant-mesh.js'
import { isFluidBlock } from './fluid-mesh.js'
import { isSpecialBlock } from './special-mesh.js'
import { quadLightAt } from './light-sampling.js'

const OPAQUE_LAYER = MESH_LAYERS.indexOf('opaque')
const AO_SHIFT = 8
const NO_FACE = 0
const NO_OFFSET = 0
const LIGHT_NIBBLE_MASK = 0x0f
const LIGHT_CORNER_SHIFT = 4
const SECOND_LIGHT_CORNER = 2
const THIRD_LIGHT_CORNER = 3

const packFaceCell = (blockId: number, ao: number): number => blockId | (ao << AO_SHIFT)

const packLightCorners = (values: readonly number[]): number => {
  let packed = NO_FACE
  for (const [corner, value] of values.entries()) {
    packed |= (value & LIGHT_NIBBLE_MASK) << (corner * LIGHT_CORNER_SHIFT)
  }
  return packed
}

const packLightChannel = (light: QuadLight, channel: 'block' | 'sky'): number => packLightCorners(light[channel])

const lightCornersFromPacked = (packed: number): readonly [number, number, number, number] => [
  packed & LIGHT_NIBBLE_MASK,
  (packed >> LIGHT_CORNER_SHIFT) & LIGHT_NIBBLE_MASK,
  (packed >> (LIGHT_CORNER_SHIFT * SECOND_LIGHT_CORNER)) & LIGHT_NIBBLE_MASK,
  (packed >> (LIGHT_CORNER_SHIFT * THIRD_LIGHT_CORNER)) & LIGHT_NIBBLE_MASK,
]

const quadLightFromPacked = (block: number, sky: number): QuadLight => ({
  block: lightCornersFromPacked(block),
  sky: lightCornersFromPacked(sky),
})

const lightPropertiesOf = (light: QuadLight | undefined): Pick<Quad, 'light'> => {
  if (light) {
    return { light }
  }
  return {}
}

const packedLightPropertiesOf = (
  chunk: ChunkView,
  blockLight: number,
  skyLight: number,
): Pick<Quad, 'light'> => {
  if (chunk.light) {
    return { light: quadLightFromPacked(blockLight, skyLight) }
  }
  return {}
}

// `cell & MAX_BLOCK_ID` (a mask of 0xFF) is always an integer in
// [0, MAX_BLOCK_ID] by construction of the bitwise AND itself — see
// `block-data.ts`'s `uncheckedBlockId` for why `Brand.nominal` applies here
// instead of a guard with a branch no caller can ever take.
const uncheckedBlockId = Brand.nominal<BlockId>()

const faceCellBlockId = (cell: number): BlockId => uncheckedBlockId(cell & MAX_BLOCK_ID)

const faceCellAo = (cell: number): number => cell >> AO_SHIFT

type EmitQuad = (
  outer: number,
  inner: number,
  outerRun: number,
  innerRun: number,
  cell: number,
  blockLight: number,
  skyLight: number,
  depth: number,
) => void

type LightMasks = {
  readonly block: Uint16Array
  readonly sky: Uint16Array
}

type GreedyMasks = {
  readonly light: LightMasks | undefined
  readonly mask: Uint16Array
}

const rowMatches = (
  masks: GreedyMasks,
  start: number,
  length: number,
  cell: number,
  blockLight: number,
  skyLight: number,
): boolean => {
  const { light } = masks
  for (let offset = FIRST_INDEX; offset < length; offset += STEP) {
    if (masks.mask[start + offset] !== cell) {
      return false
    }
    if (light && (light.block[start + offset] !== blockLight || light.sky[start + offset] !== skyLight)) {
      return false
    }
  }
  return true
}

const growInnerRun = (
  masks: GreedyMasks,
  base: number,
  inner: number,
  innerSize: number,
  cell: number,
  blockLight: number,
  skyLight: number,
): number => {
  const { light } = masks
  let innerRun = 1
  while (inner + innerRun < innerSize && masks.mask[base + innerRun] === cell) {
    const index = base + innerRun
    if (light && (light.block[index] !== blockLight || light.sky[index] !== skyLight)) {
      break
    }
    innerRun += STEP
  }
  return innerRun
}

const growOuterRun = (
  masks: GreedyMasks,
  outer: number,
  inner: number,
  outerSize: number,
  innerSize: number,
  innerRun: number,
  cell: number,
  blockLight: number,
  skyLight: number,
): number => {
  let outerRun = 1
  while (
    outer + outerRun < outerSize &&
    rowMatches(
      masks,
      (outer + outerRun) * innerSize + inner,
      innerRun,
      cell,
      blockLight,
      skyLight,
    )
  ) {
    outerRun += STEP
  }
  return outerRun
}

const clearRectangle = (
  masks: GreedyMasks,
  outer: number,
  inner: number,
  outerRun: number,
  innerRun: number,
  innerSize: number,
): void => {
  const { light } = masks
  for (let row = FIRST_INDEX; row < outerRun; row += STEP) {
    const rowStart = (outer + row) * innerSize + inner
    masks.mask.fill(NO_FACE, rowStart, rowStart + innerRun)
    light?.block.fill(NO_FACE, rowStart, rowStart + innerRun)
    light?.sky.fill(NO_FACE, rowStart, rowStart + innerRun)
  }
}

type GreedyExpansionContext = {
  readonly emit: EmitQuad
  readonly innerSize: number
  readonly masks: GreedyMasks
  readonly outerSize: number
}

const growRuns = (
  ctx: GreedyExpansionContext,
  outer: number,
  inner: number,
  cell: number,
  blockLight: number,
  skyLight: number,
): readonly [number, number] => {
  const base = outer * ctx.innerSize + inner
  const innerRun = growInnerRun(ctx.masks, base, inner, ctx.innerSize, cell, blockLight, skyLight)
  const outerRun = growOuterRun(
    ctx.masks,
    outer,
    inner,
    ctx.outerSize,
    ctx.innerSize,
    innerRun,
    cell,
    blockLight,
    skyLight,
  )
  return [innerRun, outerRun]
}

/**
 * Read one cell out of a greedy-expansion mask. Exported so the defensive
 * branch (an index `expandGreedy`'s loop bounds should never produce) has a
 * direct test instead of an untestable one buried inside `expandCell`.
 */
export const maskCellAt = (mask: Uint16Array, base: number): number => {
  const cell = mask[base]
  if (typeof cell === 'undefined') {
    throw new RangeError(`unreachable: greedy mask index ${base} out of range`)
  }
  return cell
}

const expandCell = (ctx: GreedyExpansionContext, depth: number, outer: number, inner: number): void => {
  const base = outer * ctx.innerSize + inner
  const cell = maskCellAt(ctx.masks.mask, base)
  if (cell === NO_FACE) {
    return
  }
  const { light } = ctx.masks
  const blockLight = light?.block[base] ?? NO_FACE
  const skyLight = light?.sky[base] ?? NO_FACE
  const [innerRun, outerRun] = growRuns(ctx, outer, inner, cell, blockLight, skyLight)
  clearRectangle(ctx.masks, outer, inner, outerRun, innerRun, ctx.innerSize)
  ctx.emit(outer, inner, outerRun, innerRun, cell, blockLight, skyLight, depth)
}

const expandGreedy = (ctx: GreedyExpansionContext, depth: number): void => {
  for (let outer = FIRST_INDEX; outer < ctx.outerSize; outer += STEP) {
    for (let inner = FIRST_INDEX; inner < ctx.innerSize; inner += STEP) {
      expandCell(ctx, depth, outer, inner)
    }
  }
}

type ColumnPassContext = {
  readonly chunk: ChunkView
  readonly face: Face
  readonly fluids: Uint16Array
  readonly lookup: Uint8Array
  readonly mask: Uint16Array
  readonly neighbours: ChunkNeighbours
  readonly placement: FacePlacement
  readonly plants: Uint8Array
  readonly push: (quad: Quad) => void
  readonly light: LightMasks | undefined
}

type MeshPassContext = ColumnPassContext & {
  readonly yLimit: number
}

export type MeshAllFacesContext = {
  readonly chunk: ChunkView
  readonly fluids: Uint16Array
  readonly lookup: Uint8Array
  readonly mask: Uint16Array
  readonly neighbours: ChunkNeighbours
  readonly plants: Uint8Array
  readonly push: (quad: Quad) => void
  readonly light: LightMasks | undefined
  readonly yLimit: number
}

const lightAt = (
  ctx: ColumnPassContext,
  lx: number,
  y: number,
  lz: number,
): QuadLight | undefined => {
  if (!ctx.light) {
    return
  }
  return quadLightAt(ctx.chunk, ctx.neighbours, ctx.face.direction, lx, y, lz)
}

const resolveExposedCell = (
  ctx: ColumnPassContext,
  blockId: BlockId,
  lx: number,
  y: number,
  lz: number,
  neighbourId: number,
  maskIndex: number,
): void => {
  if (isFaceExposed(ctx.lookup, ctx.plants, blockId, neighbourId)) {
    const ao = ambientOcclusionAt(ctx.chunk, ctx.neighbours, ctx.face.direction, lx, y, lz)
    const light = lightAt(ctx, lx, y, lz)
    if (layerAt(ctx.lookup, blockId) === OPAQUE_LAYER) {
      ctx.mask[maskIndex] = packFaceCell(blockId, ao)
      if (ctx.light && light) {
        ctx.light.block[maskIndex] = packLightChannel(light, 'block')
        ctx.light.sky[maskIndex] = packLightChannel(light, 'sky')
      }
    } else {
      ctx.push({
        ao,
        blockId,
        ...ctx.placement,
        ...lightPropertiesOf(light),
        height: 1,
        lx,
        lz,
        width: 1,
        y,
      })
    }
  }
}

const isPaintableCell = (ctx: ColumnPassContext, blockId: number): boolean =>
  blockId !== AIR &&
  !isCrossPlant(ctx.plants, blockId) &&
  !isFluidBlock(ctx.fluids, blockId) &&
  !isSpecialBlock(blockId)

const clearMasks = (ctx: ColumnPassContext, length: number): void => {
  ctx.mask.fill(NO_FACE, FIRST_INDEX, length)
  ctx.light?.block.fill(NO_FACE, FIRST_INDEX, length)
  ctx.light?.sky.fill(NO_FACE, FIRST_INDEX, length)
}

const fillXSliceMask = (ctx: ColumnPassContext, lx: number, yLimit: number): void => {
  const { blocks, height } = ctx.chunk
  const xBase = lx * height * CHUNK_SIZE
  clearMasks(ctx, CHUNK_SIZE * yLimit)
  for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
    const columnBase = xBase + lz * height
    const rowBase = lz * yLimit
    for (let y = FIRST_INDEX; y < yLimit; y += STEP) {
      const blockId = blockIdAt(blocks, columnBase + y)
      if (isPaintableCell(ctx, blockId)) {
        resolveExposedCell(
          ctx,
          blockId,
          lx,
          y,
          lz,
          getBlockAcrossBoundary(ctx.chunk, ctx.neighbours, lx + ctx.face.nx, y, lz),
          rowBase + y,
        )
      }
    }
  }
}

const fillYSliceMask = (ctx: ColumnPassContext, y: number): void => {
  const { blocks, height } = ctx.chunk
  clearMasks(ctx, CHUNK_SIZE * CHUNK_SIZE)
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    const columnBase = lx * height * CHUNK_SIZE + y
    const rowBase = lx * CHUNK_SIZE
    for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
      const blockId = blockIdAt(blocks, columnBase + lz * height)
      if (isPaintableCell(ctx, blockId)) {
        resolveExposedCell(
          ctx,
          blockId,
          lx,
          y,
          lz,
          getBlockAcrossBoundary(ctx.chunk, ctx.neighbours, lx, y + ctx.face.ny, lz),
          rowBase + lz,
        )
      }
    }
  }
}

const fillZSliceMask = (ctx: ColumnPassContext, lz: number, yLimit: number): void => {
  const { blocks, height } = ctx.chunk
  clearMasks(ctx, CHUNK_SIZE * yLimit)
  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    const columnBase = lz * height + lx * height * CHUNK_SIZE
    const rowBase = lx * yLimit
    for (let y = FIRST_INDEX; y < yLimit; y += STEP) {
      const blockId = blockIdAt(blocks, columnBase + y)
      if (isPaintableCell(ctx, blockId)) {
        resolveExposedCell(
          ctx,
          blockId,
          lx,
          y,
          lz,
          getBlockAcrossBoundary(ctx.chunk, ctx.neighbours, lx, y, lz + ctx.face.nz),
          rowBase + y,
        )
      }
    }
  }
}

const meshXPass = (ctx: MeshPassContext): void => {
  const masks: GreedyMasks = {
    light: ctx.light,
    mask: ctx.mask,
  }
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, blockLight, skyLight, depth) => {
    ctx.push({
      ao: faceCellAo(cell),
      blockId: faceCellBlockId(cell),
      ...ctx.placement,
      ...packedLightPropertiesOf(ctx.chunk, blockLight, skyLight),
      height: outerRun,
      lx: depth,
      lz: outer,
      width: innerRun,
      y: inner,
    })
  }
  const expansion: GreedyExpansionContext = {
    emit,
    innerSize: ctx.yLimit,
    masks,
    outerSize: CHUNK_SIZE,
  }

  for (let lx = FIRST_INDEX; lx < CHUNK_SIZE; lx += STEP) {
    fillXSliceMask(ctx, lx, ctx.yLimit)
    expandGreedy(expansion, lx)
  }
}

const meshYPass = (ctx: MeshPassContext): void => {
  const masks: GreedyMasks = {
    light: ctx.light,
    mask: ctx.mask,
  }
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, blockLight, skyLight, depth) => {
    ctx.push({
      ao: faceCellAo(cell),
      blockId: faceCellBlockId(cell),
      ...ctx.placement,
      ...packedLightPropertiesOf(ctx.chunk, blockLight, skyLight),
      height: innerRun,
      lx: outer,
      lz: inner,
      width: outerRun,
      y: depth,
    })
  }
  const expansion: GreedyExpansionContext = {
    emit,
    innerSize: CHUNK_SIZE,
    masks,
    outerSize: CHUNK_SIZE,
  }

  for (let y = FIRST_INDEX; y < ctx.yLimit; y += STEP) {
    fillYSliceMask(ctx, y)
    expandGreedy(expansion, y)
  }
}

const meshZPass = (ctx: MeshPassContext): void => {
  const masks: GreedyMasks = {
    light: ctx.light,
    mask: ctx.mask,
  }
  const emit: EmitQuad = (outer, inner, outerRun, innerRun, cell, blockLight, skyLight, depth) => {
    ctx.push({
      ao: faceCellAo(cell),
      blockId: faceCellBlockId(cell),
      ...ctx.placement,
      ...packedLightPropertiesOf(ctx.chunk, blockLight, skyLight),
      height: innerRun,
      lx: outer,
      lz: depth,
      width: outerRun,
      y: inner,
    })
  }
  const expansion: GreedyExpansionContext = {
    emit,
    innerSize: ctx.yLimit,
    masks,
    outerSize: CHUNK_SIZE,
  }

  for (let lz = FIRST_INDEX; lz < CHUNK_SIZE; lz += STEP) {
    fillZSliceMask(ctx, lz, ctx.yLimit)
    expandGreedy(expansion, lz)
  }
}

const meshFace = (ctx: MeshPassContext): void => {
  if (ctx.face.nx !== NO_OFFSET) {
    meshXPass(ctx)
  } else if (ctx.face.ny !== NO_OFFSET) {
    meshYPass(ctx)
  } else {
    meshZPass(ctx)
  }
}

export const meshAllFaces = (ctx: MeshAllFacesContext): void => {
  for (const face of FACES) {
    const faceContext: MeshPassContext = {
      chunk: ctx.chunk,
      face,
      fluids: ctx.fluids,
      light: ctx.light,
      lookup: ctx.lookup,
      mask: ctx.mask,
      neighbours: ctx.neighbours,
      placement: facePlacementOf(face.direction),
      plants: ctx.plants,
      push: ctx.push,
      yLimit: ctx.yLimit,
    }
    meshFace(faceContext)
  }
}
