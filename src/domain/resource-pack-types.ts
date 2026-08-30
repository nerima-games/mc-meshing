/* oxlint-disable no-magic-numbers -- These numeric unions are part of Minecraft's JSON protocol. */
import type { FaceDirection } from './faces.js'

/** A block state property set read from a Java resource-pack state. */
export type BlockStateProperties = Readonly<Record<string, string>>

export type ModelRotation = 0 | 90 | 180 | 270

export type BlockStateVariant = {
  readonly model: string
  readonly x?: ModelRotation
  readonly y?: ModelRotation
  readonly z?: ModelRotation
  readonly uvlock?: boolean
  readonly weight?: number
}

export type NonEmptyReadonlyArray<Value> = readonly [Value, ...Value[]]

export type BlockStateVariantList = NonEmptyReadonlyArray<BlockStateVariant>

export type BlockStateCondition =
  | Readonly<Record<string, string>>
  | BlockStateOrCondition
  | BlockStateAndCondition

export type BlockStateOrCondition = {
  readonly OR: ReadonlyArray<BlockStateCondition>
}

export type BlockStateAndCondition = {
  readonly AND: ReadonlyArray<BlockStateCondition>
}

export type BlockStateMultipart = {
  readonly when?: BlockStateCondition
  readonly apply: BlockStateVariant | BlockStateVariantList
}

export type BlockStateDefinition =
  | {
      readonly variants: Readonly<Record<string, BlockStateVariant | BlockStateVariantList>>
      readonly multipart?: never
    }
  | {
      readonly variants?: never
      readonly multipart: ReadonlyArray<BlockStateMultipart>
    }

export type ModelAxis = 'x' | 'y' | 'z'

export type ModelElementAngle = number

export const RESOURCE_MODEL_FACE_DIRECTIONS = ['down', 'up', 'north', 'south', 'west', 'east'] as const
export type ResourceModelFaceDirection = (typeof RESOURCE_MODEL_FACE_DIRECTIONS)[number]

export type ModelElementRotation = {
  readonly origin: readonly [number, number, number]
  readonly axis?: ModelAxis
  readonly angle?: ModelElementAngle
  readonly x?: ModelElementAngle
  readonly y?: ModelElementAngle
  readonly z?: ModelElementAngle
  readonly rescale?: boolean
}

export type ModelFace = {
  readonly texture: string
  readonly uv?: readonly [number, number, number, number]
  readonly rotation?: ModelRotation
  readonly cullface?: ResourceModelFaceDirection
  readonly tintindex?: number
}

export type ModelElement = {
  readonly from: readonly [number, number, number]
  readonly to: readonly [number, number, number]
  readonly rotation?: ModelElementRotation
  readonly shade?: boolean
  readonly faces: Readonly<Partial<Record<ResourceModelFaceDirection, ModelFace>>>
}

export type BlockModel = {
  readonly parent?: string
  readonly ambientocclusion?: boolean
  readonly textures?: Readonly<Record<string, string>>
  readonly elements?: ReadonlyArray<ModelElement>
}

/** JSON-compatible assets supplied by a resource-pack loader. */
export type ResourcePackAssets = {
  readonly blockstates: Readonly<Record<string, BlockStateDefinition>>
  readonly models: Readonly<Record<string, BlockModel>>
}

export type ResolvedBlockStateModel = {
  readonly model: string
  readonly x: ModelRotation
  readonly y: ModelRotation
  readonly z: ModelRotation
  readonly uvlock: boolean
}

export type BlockStateResolveOptions = {
  readonly seed?: number
}

export type ResourceModelTransform = {
  readonly x?: ModelRotation
  readonly y?: ModelRotation
  readonly z?: ModelRotation
  readonly uvlock?: boolean
}

export type ResolvedBlockModel = {
  readonly name: string
  readonly ambientOcclusion: boolean
  readonly textures: Readonly<Record<string, string>>
  readonly elements: ReadonlyArray<ModelElement>
}

export type ResourceModelVertex = readonly [number, number, number]
export type ResourceModelUv = readonly [number, number]

export type ResourceModelQuad = {
  readonly model: string
  readonly ambientOcclusion: boolean
  readonly direction: FaceDirection
  readonly normal: ResourceModelVertex
  readonly vertices: readonly [ResourceModelVertex, ResourceModelVertex, ResourceModelVertex, ResourceModelVertex]
  readonly uv: readonly [ResourceModelUv, ResourceModelUv, ResourceModelUv, ResourceModelUv]
  readonly texture: string
  readonly shade: boolean
  readonly cullface?: FaceDirection
  readonly tintIndex?: number
}
