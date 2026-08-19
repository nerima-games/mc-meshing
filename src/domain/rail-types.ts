/** The ten blockstate values used by Minecraft's vanilla rail block. */
export const RAIL_SHAPES = [
  'north_south',
  'east_west',
  'ascending_east',
  'ascending_west',
  'ascending_north',
  'ascending_south',
  'south_east',
  'south_west',
  'north_west',
  'north_east',
] as const

export type RailShape = typeof RAIL_SHAPES[number]

/** Per-cell rail state in the same Y-major layout as `ChunkView.blocks`. */
export type RailShapeView = Readonly<Uint8Array>

export const RAIL_SHAPE_COUNT = RAIL_SHAPES.length

const RAIL_SHAPE_CODES: Readonly<Record<RailShape, number>> = {
  ascending_east: 2,
  ascending_north: 4,
  ascending_south: 5,
  ascending_west: 3,
  east_west: 1,
  north_east: 9,
  north_south: 0,
  north_west: 8,
  south_east: 6,
  south_west: 7,
}

const MIN_RAIL_SHAPE_CODE = 0

/** Converts a named rail state into the compact value stored in `RailShapeView`. */
export const railShapeCodeOf = (shape: RailShape): number => RAIL_SHAPE_CODES[shape]

/** Converts a compact rail state into its blockstate name. */
export const railShapeOf = (code: number): RailShape => {
  if (!Number.isInteger(code) || code < MIN_RAIL_SHAPE_CODE || code >= RAIL_SHAPE_COUNT) {
    throw new RangeError(`Invalid rail shape code: ${code}`)
  }
  return RAIL_SHAPES[code] as RailShape
}

/** Reads one optional state value, treating an absent sidecar cell as unknown. */
export const railShapeAt = (view: RailShapeView | undefined, index: number): RailShape | undefined => {
  const code = view?.[index]
  if (typeof code !== 'number') {
    return
  }
  return railShapeOf(code)
}
