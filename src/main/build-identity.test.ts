import { describe, expect, it } from 'vitest'
import { KUN_RUNTIME_BUILD_HASH } from '../../kun/src/version'
import { KUN_GUI_BUILD_HASH } from '../shared/build-identity'

describe('build identity', () => {
  it('embeds the same git commit hash in GUI and runtime code', () => {
    expect(KUN_GUI_BUILD_HASH).toBe(KUN_RUNTIME_BUILD_HASH)
    expect(KUN_GUI_BUILD_HASH).toMatch(/^[0-9a-f]{40}$/)
  })
})
