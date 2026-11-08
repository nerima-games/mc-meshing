import { Result } from 'effect'

export type MeshScratchBuffers = {
  readonly mask: Uint32Array
  readonly blockStateMask?: Uint32Array
  readonly light?: {
    readonly block: Uint16Array
    readonly sky: Uint16Array
  }
}

const MIN_BUFFER_LENGTH = 0

export type MeshScratchFailure = {
  readonly _tag: 'InvalidMeshScratchLength'
  readonly required: number
}

const validateRequiredLength = (required: number): Result.Result<void, MeshScratchFailure> => {
  if (!Number.isSafeInteger(required) || required < MIN_BUFFER_LENGTH) {
    return Result.fail({ _tag: 'InvalidMeshScratchLength', required })
  }
  return Result.void
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

const blockStateMaskBufferAtLeast = (
  current: Uint32Array<ArrayBufferLike>,
  required: number,
): Uint32Array<ArrayBufferLike> => {
  if (current.length >= required) {
    return current
  }
  return new Uint32Array(required)
}

/**
 * Reusable per-caller workspace for meshing. Do not share one instance across
 * concurrent mesh operations.
 */
export class MeshScratch {
  #mask: Uint32Array<ArrayBufferLike>
  #blockStateMask: Uint32Array<ArrayBufferLike>
  #blockLight: Uint16Array<ArrayBufferLike>
  #skyLight: Uint16Array<ArrayBufferLike>

  private constructor() {
    this.#mask = new Uint32Array()
    this.#blockStateMask = new Uint32Array()
    this.#blockLight = new Uint16Array()
    this.#skyLight = new Uint16Array()
  }

  static create(): MeshScratch {
    return new MeshScratch()
  }

  buffersFor(
    required: number,
    withLight: boolean,
    withBlockStateMask = false,
  ): Result.Result<MeshScratchBuffers, MeshScratchFailure> {
    const validLength = validateRequiredLength(required)
    if (Result.isFailure(validLength)) {
      return Result.fail(validLength.failure)
    }
    this.#mask = maskBufferAtLeast(this.#mask, required)
    if (withBlockStateMask) {
      this.#blockStateMask = blockStateMaskBufferAtLeast(this.#blockStateMask, required)
    }
    const blockStateMask = withBlockStateMask ? { blockStateMask: this.#blockStateMask } : {}

    if (!withLight) {
      return Result.succeed({ mask: this.#mask, ...blockStateMask })
    }

    this.#blockLight = lightBufferAtLeast(this.#blockLight, required)
    this.#skyLight = lightBufferAtLeast(this.#skyLight, required)
    return Result.succeed({
      light: { block: this.#blockLight, sky: this.#skyLight },
      mask: this.#mask,
      ...blockStateMask,
    })
  }
}

export const createMeshScratch = (): MeshScratch => MeshScratch.create()
