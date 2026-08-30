import {
  type MeshLayers,
  type Quad,
} from './mesh-types.js'
import type { CrossPlantQuad } from './plant-types.js'
import type { FluidQuad } from './fluid-types.js'
import { MESH_LAYERS, type MeshLayer } from './opacity.js'
import type { QuadLight } from './light-types.js'
import type { SpecialBlockQuad } from './special-types.js'
import { faceOf } from './faces.js'

const CELL_SIZE = 1
const COMPONENTS_PER_VERTEX = 3
const FIRST_COMPONENT = 0
const SECOND_COMPONENT = 1
const THIRD_COMPONENT = 2
const FIRST_INDEX = 0
const SECOND_INDEX = 1
const THIRD_INDEX = 2
const FOURTH_INDEX = 3
const FIFTH_INDEX = 4
const SIXTH_INDEX = 5
const VERTICES_PER_QUAD = 4
const INDICES_PER_QUAD = 6
const NO_AMBIENT_OCCLUSION = 0
const NO_LIGHT = 0

type Vertex = readonly [number, number, number]
type VertexQuad = readonly [Vertex, Vertex, Vertex, Vertex]
type Normal = readonly [number, number, number]

export const MESH_BUFFER_LAYERS: readonly [
  MeshLayer,
  MeshLayer,
  MeshLayer,
  'crossPlants',
  'fluids',
  'specialBlocks',
] = [...MESH_LAYERS, 'crossPlants', 'fluids', 'specialBlocks'] as const

export type MeshBufferLayer = (typeof MESH_BUFFER_LAYERS)[number]

export type MeshBufferGroup = {
  readonly layer: MeshBufferLayer
  readonly vertexOffset: number
  readonly vertexCount: number
  readonly indexOffset: number
  readonly indexCount: number
}

export type PackedMeshBuffers = {
  readonly positions: Float32Array
  readonly normals: Int8Array
  readonly blockIds: Uint8Array
  readonly ambientOcclusion: Uint8Array
  readonly blockLight: Uint8Array
  readonly skyLight: Uint8Array
  readonly indices: Uint32Array
  readonly groups: ReadonlyArray<MeshBufferGroup>
}

type MutableOffsets = {
  indexOffset: number
  vertexOffset: number
}

type PackedArrays = Pick<
  PackedMeshBuffers,
  'positions' | 'normals' | 'blockIds' | 'ambientOcclusion' | 'blockLight' | 'skyLight' | 'indices'
>

type MeshBufferWriter = {
  offsets: MutableOffsets
  output: PackedArrays
}

type QuadBufferSource = {
  ambientOcclusion: number
  blockId: number
  light?: QuadLight
  normal: Normal
  vertices: VertexQuad
}

type CubeBounds = {
  xFace: number
  xMax: number
  xMin: number
  yFace: number
  yMax: number
  yMin: number
  ySideMax: number
  zFace: number
  zMax: number
  zMin: number
}

const lightPropertiesOf = (light?: QuadLight): Pick<QuadBufferSource, 'light'> => {
  if (light) {
    return { light }
  }
  return {}
}

const cubeBoundsOf = (quad: Quad): CubeBounds => ({
  xFace: quad.lx + CELL_SIZE,
  xMax: quad.lx + quad.width,
  xMin: quad.lx,
  yFace: quad.y + CELL_SIZE,
  yMax: quad.y + quad.height,
  yMin: quad.y,
  ySideMax: quad.y + quad.width,
  zFace: quad.lz + CELL_SIZE,
  zMax: quad.lz + quad.height,
  zMin: quad.lz,
})

const cubeVerticesOf = (quad: Quad): VertexQuad => {
  const {
    xFace,
    xMax,
    xMin,
    yFace,
    yMax,
    yMin,
    ySideMax,
    zFace,
    zMax,
    zMin,
  } = cubeBoundsOf(quad)

  switch (quad.direction) {
    case 'xPos':
      return [
        [xFace, yMin, zMin],
        [xFace, ySideMax, zMin],
        [xFace, ySideMax, zMax],
        [xFace, yMin, zMax],
      ]
    case 'xNeg':
      return [
        [xMin, yMin, zMax],
        [xMin, ySideMax, zMax],
        [xMin, ySideMax, zMin],
        [xMin, yMin, zMin],
      ]
    case 'yPos':
      return [
        [xMin, yFace, zMin],
        [xMin, yFace, zMax],
        [xMax, yFace, zMax],
        [xMax, yFace, zMin],
      ]
    case 'yNeg':
      return [
        [xMin, yMin, zMax],
        [xMin, yMin, zMin],
        [xMax, yMin, zMin],
        [xMax, yMin, zMax],
      ]
    case 'zPos':
      return [
        [xMax, yMin, zFace],
        [xMax, yMax, zFace],
        [xMin, yMax, zFace],
        [xMin, yMin, zFace],
      ]
    default:
      return [
        [xMin, yMin, zMin],
        [xMin, yMax, zMin],
        [xMax, yMax, zMin],
        [xMax, yMin, zMin],
      ]
  }
}

type NumericBuffer = Float32Array | Int8Array

const writeVector = (
  vector: Vertex | Normal,
  offset: number,
  output: NumericBuffer,
): void => {
  const [first, second, third] = vector
  output[offset + FIRST_COMPONENT] = first
  output[offset + SECOND_COMPONENT] = second
  output[offset + THIRD_COMPONENT] = third
}

const writeVertex = (
  source: QuadBufferSource,
  vertex: Vertex,
  vertexIndex: number,
  writer: MeshBufferWriter,
): void => {
  const { ambientOcclusion, blockIds, blockLight, normals, positions, skyLight } = writer.output
  const { vertexOffset } = writer.offsets
  const bufferVertexIndex = vertexOffset + vertexIndex
  const positionOffset = bufferVertexIndex * COMPONENTS_PER_VERTEX
  writeVector(vertex, positionOffset, positions)
  writeVector(source.normal, positionOffset, normals)
  blockIds[bufferVertexIndex] = source.blockId
  ambientOcclusion[bufferVertexIndex] = source.ambientOcclusion
  blockLight[bufferVertexIndex] = source.light?.block[vertexIndex] ?? NO_LIGHT
  skyLight[bufferVertexIndex] = source.light?.sky[vertexIndex] ?? NO_LIGHT
}

const writeIndices = (writer: MeshBufferWriter): void => {
  const { indices } = writer.output
  const { indexOffset, vertexOffset } = writer.offsets
  indices[indexOffset + FIRST_INDEX] = vertexOffset + FIRST_INDEX
  indices[indexOffset + SECOND_INDEX] = vertexOffset + SECOND_INDEX
  indices[indexOffset + THIRD_INDEX] = vertexOffset + THIRD_INDEX
  indices[indexOffset + FOURTH_INDEX] = vertexOffset + FIRST_INDEX
  indices[indexOffset + FIFTH_INDEX] = vertexOffset + THIRD_INDEX
  indices[indexOffset + SIXTH_INDEX] = vertexOffset + FOURTH_INDEX
}

const writeQuad = (
  source: QuadBufferSource,
  writer: MeshBufferWriter,
): void => {
  for (const [vertexIndex, vertex] of source.vertices.entries()) {
    writeVertex(source, vertex, vertexIndex, writer)
  }
  writeIndices(writer)
  writer.offsets.vertexOffset += VERTICES_PER_QUAD
  writer.offsets.indexOffset += INDICES_PER_QUAD
}

const writeCubeQuad = (quad: Quad, writer: MeshBufferWriter): void => {
  const face = faceOf(quad.direction)
  writeQuad(
    {
      ambientOcclusion: quad.ao,
      blockId: quad.blockId,
      ...lightPropertiesOf(quad.light),
      normal: [face.nx, face.ny, face.nz],
      vertices: cubeVerticesOf(quad),
    },
    writer,
  )
}

type ExplicitQuad = CrossPlantQuad | FluidQuad | SpecialBlockQuad

const normalOfExplicitQuad = (quad: ExplicitQuad): Normal => {
  if ('nx' in quad) {
    return [quad.nx, quad.ny, quad.nz]
  }
  const face = faceOf(quad.direction)
  return [face.nx, face.ny, face.nz]
}

const ambientOcclusionOfExplicitQuad = (quad: ExplicitQuad): number => {
  if ('ao' in quad) {
    return quad.ao
  }
  return NO_AMBIENT_OCCLUSION
}

const writeExplicitQuad = (quad: ExplicitQuad, writer: MeshBufferWriter): void => {
  writeQuad(
    {
      ambientOcclusion: ambientOcclusionOfExplicitQuad(quad),
      blockId: quad.blockId,
      ...lightPropertiesOf(quad.light),
      normal: normalOfExplicitQuad(quad),
      vertices: quad.vertices,
    },
    writer,
  )
}

const appendExplicitGroup = (
  quads: ReadonlyArray<ExplicitQuad>,
  writer: MeshBufferWriter,
): void => {
  for (const quad of quads) {
    writeExplicitQuad(quad, writer)
  }
}

const appendCubeGroup = (quads: ReadonlyArray<Quad>, writer: MeshBufferWriter): void => {
  for (const quad of quads) {
    writeCubeQuad(quad, writer)
  }
}

const appendGroup = (
  layer: MeshBufferLayer,
  layers: MeshLayers,
  writer: MeshBufferWriter,
): void => {
  switch (layer) {
    case 'opaque':
    case 'water':
    case 'transparentSolid':
      appendCubeGroup(layers[layer], writer)
      return
    case 'crossPlants':
      appendExplicitGroup(layers.crossPlants, writer)
      return
    case 'fluids':
      appendExplicitGroup(layers.fluids, writer)
      return
    case 'specialBlocks':
      appendExplicitGroup(layers.specialBlocks, writer)
      return
    // MeshBufferLayer and MESH_BUFFER_LAYERS are exhaustive by construction.
    // oxlint-disable-next-line capitalized-comments
    /* c8 ignore next */
    default:
      // oxlint-disable-next-line capitalized-comments
      /* c8 ignore next */
      return
  }
}

export const packMeshLayers = (layers: MeshLayers): PackedMeshBuffers => {
  const quadCount = MESH_BUFFER_LAYERS.reduce(
    (count, layer) => count + layers[layer].length,
    FIRST_INDEX,
  )
  const output: PackedArrays = {
    ambientOcclusion: new Uint8Array(quadCount * VERTICES_PER_QUAD),
    blockIds: new Uint8Array(quadCount * VERTICES_PER_QUAD),
    blockLight: new Uint8Array(quadCount * VERTICES_PER_QUAD),
    indices: new Uint32Array(quadCount * INDICES_PER_QUAD),
    normals: new Int8Array(quadCount * VERTICES_PER_QUAD * COMPONENTS_PER_VERTEX),
    positions: new Float32Array(quadCount * VERTICES_PER_QUAD * COMPONENTS_PER_VERTEX),
    skyLight: new Uint8Array(quadCount * VERTICES_PER_QUAD),
  }
  const offsets: MutableOffsets = {
    indexOffset: FIRST_INDEX,
    vertexOffset: FIRST_INDEX,
  }
  const groups: MeshBufferGroup[] = []
  const writer: MeshBufferWriter = { offsets, output }

  for (const layer of MESH_BUFFER_LAYERS) {
    const { indexOffset, vertexOffset } = offsets
    appendGroup(layer, layers, writer)
    groups.push({
      indexCount: offsets.indexOffset - indexOffset,
      indexOffset,
      layer,
      vertexCount: offsets.vertexOffset - vertexOffset,
      vertexOffset,
    })
  }

  return { ...output, groups }
}
