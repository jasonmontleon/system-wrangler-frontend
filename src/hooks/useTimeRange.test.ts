// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { PRESETS, stepFor } from './useTimeRange'

describe('stepFor', () => {
  it.each([
    { window: 3600, expected: 15 },
    { window: 6 * 3600, expected: 60 },
    { window: 24 * 3600, expected: 240 },
    { window: 7 * 24 * 3600, expected: 1800 },
    { window: 30 * 24 * 3600, expected: 7200 },
    { window: 365 * 24 * 3600, expected: 86400 },
  ])('window=$window → step=$expected', ({ window, expected }) => {
    expect(stepFor(window)).toBe(expected)
  })

  it('never returns below the 15s scrape interval', () => {
    expect(stepFor(60)).toBe(15)
    expect(stepFor(1)).toBe(15)
    expect(stepFor(0)).toBe(15)
  })

  it('keeps every preset under Prometheus 11k-point cap', () => {
    for (const p of PRESETS) {
      const points = p.seconds / stepFor(p.seconds)
      expect(points).toBeLessThanOrEqual(400)
    }
  })
})
