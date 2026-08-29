import type { FaceDirection, FaceRole } from './faces.js'

export type QuadVertex = readonly [x: number, y: number, z: number]

export type QuadCorners = readonly [QuadVertex, QuadVertex, QuadVertex, QuadVertex]

export type MeshQuad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly width: number
  readonly height: number
  readonly ao: number
}

export type PlantVertex = QuadVertex

export type CrossPlantQuad = {
  readonly blockId: number
  readonly role: FaceRole
  readonly vertices: QuadCorners
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly ao: number
}

export type BlockShapeKind = 'slab' | 'pressurePlate' | 'cactus' | 'rail' | 'lilyPad'

export type BlockShapeQuad = {
  readonly blockId: number
  readonly shape: BlockShapeKind
  readonly direction: FaceDirection
  readonly role: FaceRole
  readonly lx: number
  readonly y: number
  readonly lz: number
  readonly width: number
  readonly height: number
  readonly vertices: QuadCorners
  readonly ao: number
}

export type GeometryQuad = MeshQuad | CrossPlantQuad | BlockShapeQuad

export const isCrossPlantQuad = (quad: GeometryQuad): quad is CrossPlantQuad => 'nx' in quad

export const isBlockShapeQuad = (quad: GeometryQuad): quad is BlockShapeQuad => 'shape' in quad

export type FluidVertex = QuadVertex

export type FluidFlow = {
  readonly direction: readonly [x: number, z: number]
  readonly falling: boolean
}

export type FluidQuad = {
  readonly blockId: number
  readonly direction: FaceDirection
  readonly vertices: QuadCorners
  readonly flow?: FluidFlow
  readonly ao: number
}
