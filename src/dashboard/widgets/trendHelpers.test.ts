// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { aggSeriesLabel } from './trendHelpers'

describe('aggSeriesLabel', () => {
  it('returns "Average" for the avg agg', () => {
    expect(aggSeriesLabel({ agg: 'avg' })).toBe('Average')
  })

  it('returns "Peak" for the peak agg', () => {
    expect(aggSeriesLabel({ agg: 'peak' })).toBe('Peak')
  })

  it('returns the empty string for an unknown agg', () => {
    expect(aggSeriesLabel({})).toBe('')
    expect(aggSeriesLabel({ agg: 'p99' })).toBe('')
  })
})
