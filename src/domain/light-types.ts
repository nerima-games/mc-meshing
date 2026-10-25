import { LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN, LightLevel as lightLevel } from '@nerima-games/mc-kernel'
import type { LightLevel } from '@nerima-games/mc-kernel'

export {
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
} from '@nerima-games/mc-kernel'

export type { LightLevel } from '@nerima-games/mc-kernel'

export type LightCorners = readonly [LightLevel, LightLevel, LightLevel, LightLevel]

export type QuadLight = {
  readonly block: LightCorners
  readonly sky: LightCorners
}

export type LightView = {
  readonly blockLight: Readonly<Uint8Array>
  readonly skyLight: Readonly<Uint8Array>
}

export const clampMeshLight = (value: number): LightLevel => {
  const clamped = Number.isNaN(value)
    ? LIGHT_LEVEL_MIN
    : Math.max(LIGHT_LEVEL_MIN, Math.min(LIGHT_LEVEL_MAX, Math.trunc(value)))
  return lightLevel(clamped)
}
