export type MeshScratchBuffers = {
  readonly mask: Uint32Array
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

const maskBufferAtLeast = (
  current: Uint32Array<ArrayBufferLike>,
  required: number,
): Uint32Array<ArrayBufferLike> => {
  if (current.length >= required) {
    return current
  }
  return new Uint32Array(required)
}

const lightBufferAtLeast = (
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
  #mask: Uint32Array<ArrayBufferLike>
  #blockLight: Uint16Array<ArrayBufferLike>
  #skyLight: Uint16Array<ArrayBufferLike>

  private constructor() {
    this.#mask = new Uint32Array()
    this.#blockLight = new Uint16Array()
    this.#skyLight = new Uint16Array()
  }

  static create(): MeshScratch {
    return new MeshScratch()
  }

  buffersFor(required: number, withLight: boolean): MeshScratchBuffers {
    assertRequiredLength(required)
    this.#mask = maskBufferAtLeast(this.#mask, required)

    if (!withLight) {
      return { mask: this.#mask }
    }

    this.#blockLight = lightBufferAtLeast(this.#blockLight, required)
    this.#skyLight = lightBufferAtLeast(this.#skyLight, required)
    return {
      light: { block: this.#blockLight, sky: this.#skyLight },
      mask: this.#mask,
    }
  }
}

export const createMeshScratch = (): MeshScratch => MeshScratch.create()
