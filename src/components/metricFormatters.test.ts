// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { formatMountLabel, PERCENT_ATTENTION_BANDS } from './metricFormatters'

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
