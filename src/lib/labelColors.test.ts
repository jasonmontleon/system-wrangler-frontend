// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { ALL_LABEL_COLORS } from '../api/labelStyles'
import { colorFor } from './labelColors'

describe('colorFor', () => {
  it('returns the override when one is present', () => {
    expect(colorFor('env', { env: 'red' })).toBe('red')
  })

  it('overrides win even when the key would also hash to a color', () => {
    // A non-override result will be SOMETHING in the palette; the
    // override must short-circuit that and produce exactly the chosen
    // color regardless of the hash.
    const overrides = { env: 'orangered' as const }
    expect(colorFor('env', overrides)).toBe('orangered')
  })

  it('is deterministic across calls for the same key', () => {
    const a = colorFor('role')
    const b = colorFor('role')
    expect(a).toBe(b)
  })

  it('returns a color from the allowed palette', () => {
    for (const key of ['env', 'role', 'team', 'oncall', 'archived', 'tier']) {
      expect(ALL_LABEL_COLORS).toContain(colorFor(key))
    }
  })

  it('different keys can hash to different colors (sanity)', () => {
    const colors = new Set([
      colorFor('a'),
      colorFor('b'),
      colorFor('c'),
      colorFor('d'),
      colorFor('e'),
    ])
    expect(colors.size).toBeGreaterThan(1)
  })

  it('passing an empty overrides object falls back to the hash', () => {
    const hashed = colorFor('env')
    expect(colorFor('env', {})).toBe(hashed)
  })

  it('overrides for a different key do not affect the queried key', () => {
    const hashed = colorFor('env')
    expect(colorFor('env', { role: 'red' })).toBe(hashed)
  })
})
