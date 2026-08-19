import {
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
} from '@nerima-games/mc-kernel'

export {
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
} from '@nerima-games/mc-kernel'

export type { LightLevel } from '@nerima-games/mc-kernel'

export type LightCorners = readonly [
  number,
  number,
  number,
  number,
]

export type QuadLight = {
  readonly block: LightCorners
  readonly sky: LightCorners
}

export type LightView = {
  readonly blockLight: Readonly<Uint8Array>
  readonly skyLight: Readonly<Uint8Array>
}

export const clampMeshLight = (value: number): number =>
  Math.max(LIGHT_LEVEL_MIN, Math.min(LIGHT_LEVEL_MAX, Math.trunc(value)))
