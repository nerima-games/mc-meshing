import type { BlockId } from './block-data.js'
import type { Face } from './faces.js'
import type { QuadLight } from './light-types.js'
import type { RailKind } from '@nerima-games/mc-kernel'
import type { RailShape } from './rail-types.js'

export type SpecialRenderKind = 'cactus' | 'lilyPad' | 'pressurePlate' | 'rail' | 'slab'

export type SpecialVertex = readonly [x: number, y: number, z: number]

type SpecialQuadGeometry = Face & {
  readonly blockId: BlockId
  readonly vertices: readonly [SpecialVertex, SpecialVertex, SpecialVertex, SpecialVertex]
  readonly light?: QuadLight
}

export type NonRailSpecialBlockQuad = SpecialQuadGeometry & {
  readonly kind: Exclude<SpecialRenderKind, 'rail'>
}

export type RailRenderKind = Exclude<RailKind, 'none'>

export const railRenderKindOf = (railKind: RailKind): RailRenderKind => {
  if (railKind === 'none') {
    throw new Error('A rail render quad must declare a rail kind')
  }
  return railKind
}

export type RailSpecialBlockQuad = SpecialQuadGeometry & {
  readonly kind: 'rail'
  readonly railKind: RailRenderKind
  /** Present when the caller supplied the decoded per-cell rail state. */
  readonly railShape?: RailShape
}

export type SpecialBlockQuad = NonRailSpecialBlockQuad | RailSpecialBlockQuad

/** A chunk-local, half-open region used to restrict special geometry output. */
export type SpecialMeshRegion = {
  readonly min: readonly [lx: number, y: number, lz: number]
  readonly max: readonly [lx: number, y: number, lz: number]
}
