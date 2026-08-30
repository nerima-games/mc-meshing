import { Effect } from 'effect'
import { describe, expect, it as vitestIt, type TestAPI } from 'vitest'

type EffectCase = <A, E>(
  name: string,
  self: () => Effect.Effect<A, E, never>,
  timeout?: number,
) => void

const effect: EffectCase = (name, self, timeout) => vitestIt(name, () => Effect.runPromise(self()), timeout)

export { describe, expect }
export const it: TestAPI & { effect: EffectCase } = Object.assign(vitestIt, { effect })
