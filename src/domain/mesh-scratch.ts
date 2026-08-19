export type MeshScratchBuffers = {
  readonly mask: Uint16Array
  readonly light?: {
    readonly block: Uint16Array
    readonly sky: Uint16Array
  }
}

const MIN_BUFFER_LENGTH = 0

const assertRequiredLength = (required: number): void => {
  if (!Number.isSafeInteger(required) || required < MIN_BUFFER_LENGTH) {
    throw new RangeError('MeshScratch buffer length must be a non-negative safe integer')
  }
}

const bufferAtLeast = (
  current: Uint16Array<ArrayBufferLike>,
  required: number,
): Uint16Array<ArrayBufferLike> => {
  if (current.length >= required) {
    return current
  }
  return new Uint16Array(required)
}

/**
 * Reusable per-caller workspace for meshing. Do not share one instance across
 * concurrent mesh operations.
 */
export class MeshScratch {
  #mask: Uint16Array<ArrayBufferLike>
  #blockLight: Uint16Array<ArrayBufferLike>
  #skyLight: Uint16Array<ArrayBufferLike>

  private constructor() {
    this.#mask = new Uint16Array()
    this.#blockLight = new Uint16Array()
    this.#skyLight = new Uint16Array()
  }

  static create(): MeshScratch {
    return new MeshScratch()
  }

  buffersFor(required: number, withLight: boolean): MeshScratchBuffers {
    assertRequiredLength(required)
    this.#mask = bufferAtLeast(this.#mask, required)

    if (!withLight) {
      return { mask: this.#mask }
    }

    this.#blockLight = bufferAtLeast(this.#blockLight, required)
    this.#skyLight = bufferAtLeast(this.#skyLight, required)
    return {
      light: { block: this.#blockLight, sky: this.#skyLight },
      mask: this.#mask,
    }
  }
}

export const createMeshScratch = (): MeshScratch => MeshScratch.create()
