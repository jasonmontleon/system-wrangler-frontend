// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KiB'],
    [2_500_000, '2.4 MiB'],
    [3 * 1024 * 1024 * 1024, '3.0 GiB'],
    [5 * 1024 * 1024 * 1024 * 1024, '5.0 TiB'],
  ])('formats %d as %s', (input, want) => {
    expect(formatBytes(input)).toBe(want)
  })
})
