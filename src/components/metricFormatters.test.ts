// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  formatBytesPerSec,
  formatMountLabel,
  formatPct,
  PERCENT_ATTENTION_BANDS,
  tintForPending,
  tintForPercent,
} from './metricFormatters'

describe('formatMountLabel', () => {
  it('strips /System/Volumes/ prefix from macOS mountpoints', () => {
    expect(formatMountLabel({ mountpoint: '/System/Volumes/Data' })).toBe('Data')
    expect(formatMountLabel({ mountpoint: '/System/Volumes/Update/SFR/mnt1' })).toBe(
      'Update/SFR/mnt1',
    )
    expect(formatMountLabel({ mountpoint: '/System/Volumes/VM' })).toBe('VM')
  })

  it('strips /Volumes/ prefix from user-mounted macOS drives', () => {
    expect(formatMountLabel({ mountpoint: '/Volumes/Backup' })).toBe('Backup')
    expect(formatMountLabel({ mountpoint: '/Volumes/External SSD' })).toBe('External SSD')
  })

  it('leaves Linux mountpoints unchanged', () => {
    expect(formatMountLabel({ mountpoint: '/' })).toBe('/')
    expect(formatMountLabel({ mountpoint: '/var/log' })).toBe('/var/log')
    expect(formatMountLabel({ mountpoint: '/home/user' })).toBe('/home/user')
  })

  it('returns the Windows volume label when present', () => {
    expect(formatMountLabel({ volume: 'C:' })).toBe('C:')
    expect(formatMountLabel({ volume: 'D:' })).toBe('D:')
  })

  it('prefers mountpoint over volume when both are present', () => {
    expect(formatMountLabel({ mountpoint: '/', volume: 'C:' })).toBe('/')
  })

  it('returns empty string when neither label is present', () => {
    expect(formatMountLabel({})).toBe('')
  })
})

describe('tintForPercent', () => {
  it('returns undefined for undefined / NaN / Infinity', () => {
    expect(tintForPercent(undefined)).toBeUndefined()
    expect(tintForPercent(NaN)).toBeUndefined()
    expect(tintForPercent(Infinity)).toBeUndefined()
  })
  it('returns the success tint below 60%', () => {
    expect(tintForPercent(0)).toContain('success')
    expect(tintForPercent(59.99)).toContain('success')
  })
  it('returns the warning tint between 60% and 85%', () => {
    expect(tintForPercent(60)).toContain('warning')
    expect(tintForPercent(84.99)).toContain('warning')
  })
  it('returns the danger tint at 85% and above', () => {
    expect(tintForPercent(85)).toContain('danger')
    expect(tintForPercent(100)).toContain('danger')
  })
})

describe('tintForPending', () => {
  it('returns undefined for undefined / zero', () => {
    expect(tintForPending(undefined)).toBeUndefined()
    expect(tintForPending(0)).toBeUndefined()
  })
  it('returns the warning tint below 10', () => {
    expect(tintForPending(1)).toContain('warning')
    expect(tintForPending(9)).toContain('warning')
  })
  it('returns the danger tint at 10 and above', () => {
    expect(tintForPending(10)).toContain('danger')
    expect(tintForPending(99)).toContain('danger')
  })
})

describe('formatPct', () => {
  it('returns the em-dash placeholder for undefined / non-finite', () => {
    expect(formatPct(undefined)).toBe('—')
    expect(formatPct(NaN)).toBe('—')
    expect(formatPct(Infinity)).toBe('—')
  })
  it('rounds to a whole-percent display', () => {
    expect(formatPct(0)).toBe('0%')
    expect(formatPct(42.7)).toBe('43%')
    expect(formatPct(99.4)).toBe('99%')
    expect(formatPct(100)).toBe('100%')
  })
})

describe('formatBytesPerSec', () => {
  it('uses B/s under 1000', () => {
    expect(formatBytesPerSec(0)).toBe('0 B/s')
    expect(formatBytesPerSec(999)).toBe('999 B/s')
  })
  it('uses KB/s between 1 KB and 1 MB', () => {
    expect(formatBytesPerSec(1000)).toBe('1.0 KB/s')
    expect(formatBytesPerSec(2500)).toBe('2.5 KB/s')
  })
  it('uses MB/s between 1 MB and 1 GB', () => {
    expect(formatBytesPerSec(1_500_000)).toBe('1.5 MB/s')
    expect(formatBytesPerSec(999_999_999)).toBe('1000.0 MB/s')
  })
  it('uses GB/s between 1 GB and 1 TB', () => {
    expect(formatBytesPerSec(1_500_000_000)).toBe('1.5 GB/s')
    expect(formatBytesPerSec(999_999_999_999)).toBe('1000.0 GB/s')
  })
  it('uses TB/s at 1 TB and above', () => {
    expect(formatBytesPerSec(1_500_000_000_000)).toBe('1.5 TB/s')
    expect(formatBytesPerSec(5_000_000_000_000)).toBe('5.0 TB/s')
  })
  it('handles negative values by symmetric magnitude bucketing', () => {
    expect(formatBytesPerSec(-1_500_000)).toBe('-1.5 MB/s')
  })
})

describe('PERCENT_ATTENTION_BANDS', () => {
  it('defines contiguous warning and danger zones that hand off at 85%', () => {
    const [warning, danger] = PERCENT_ATTENTION_BANDS
    expect(warning).toEqual({
      from: 60,
      to: 85,
      color: '#F0AB00',
      opacity: 0.1,
    })
    expect(danger).toEqual({
      from: 85,
      to: 100,
      color: '#C9190B',
      opacity: 0.12,
    })
    expect(warning.to).toBe(danger.from)
  })
})
