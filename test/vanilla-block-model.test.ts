import { describe, expect, it } from './effect-test.js'
import { BLOCK_IDS, blockTypeOfId } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import {
  classifyVanillaBlockType,
  EXPLICIT_CUBE_BLOCK_TYPES,
  type VanillaBlockModelClass,
} from '../src/domain/vanilla-block-model.js'

const MODEL_CLASSES = new Set<VanillaBlockModelClass>(['air', 'cube', 'cross', 'crop', 'fluid', 'special'])

describe('vanilla block model classification', () => {
  it('classifies every registered kernel block exactly once', () => {
    expect(BLOCK_IDS.length).toBeGreaterThan(0)

    const seenBlockIds = new Set<number>()
    const seenBlockTypes = new Set<string>()
    const failures: Array<string> = []
    for (const blockId of BLOCK_IDS) {
      expect(seenBlockIds.has(blockId)).toBe(false)
      seenBlockIds.add(blockId)

      const blockType = blockTypeOfId(blockId)
      if (Result.isFailure(blockType)) {
        failures.push(`${blockId}: registry lookup failed`)
        continue
      }

      if (typeof blockType.success === 'undefined') {
        failures.push(`${blockId}: missing block type`)
        continue
      }
      expect(seenBlockTypes.has(blockType.success)).toBe(false)
      seenBlockTypes.add(blockType.success)

      const classification = classifyVanillaBlockType(blockType.success)
      if (Result.isFailure(classification)) {
        failures.push(`${blockType.success}: classification failed`)
        continue
      }
      expect(MODEL_CLASSES.has(classification.success)).toBe(true)
    }

    expect(seenBlockIds.size).toBe(BLOCK_IDS.length)
    expect(seenBlockTypes.size).toBe(BLOCK_IDS.length)
    expect(failures).toEqual([])
  })

  it('keeps every explicitly named cube in the cube class', () => {
    expect(EXPLICIT_CUBE_BLOCK_TYPES.size).toBeGreaterThan(0)
    for (const blockType of EXPLICIT_CUBE_BLOCK_TYPES) {
      expect(classifyVanillaBlockType(blockType)).toEqual(Result.succeed('cube'))
    }
  })

  it('classifies air separately from block geometry', () => {
    expect(classifyVanillaBlockType('air')).toEqual(Result.succeed('air'))
  })

  it('returns a typed failure for an unclassified registry type', () => {
    const blockType = 'future_registry_block'
    expect(classifyVanillaBlockType(blockType)).toEqual(
      Result.fail({ _tag: 'UnclassifiedVanillaBlockType', blockType }),
    )
  })
})
