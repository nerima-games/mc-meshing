import type { BlockId } from './block-data.js'
import type { FaceDirection } from './faces.js'
import type { QuadLight } from './light-types.js'

export type FluidVertex = readonly [number, number, number]

export type FluidFlow = {
  readonly direction: readonly [x: number, z: number]
  readonly falling: boolean
}

export type FluidQuad = {
  readonly blockId: BlockId
  readonly direction: FaceDirection
  readonly vertices: readonly [FluidVertex, FluidVertex, FluidVertex, FluidVertex]
  readonly flow?: FluidFlow
  readonly ao: number
  readonly light?: QuadLight
}

export const NO_FLUID_QUADS: ReadonlyArray<FluidQuad> = Object.freeze([])
