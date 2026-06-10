// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REBOOT_GRACE_MS, useRebootGraceMs } from './useRebootGraceMs'
import { getRebootGraceSeconds } from '../api/settings'

vi.mock('../api/settings', () => ({
  getRebootGraceSeconds: vi.fn(),
}))

const mockGet = vi.mocked(getRebootGraceSeconds)

describe('useRebootGraceMs', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts at the default and adopts the fetched value in ms', async () => {
    mockGet.mockResolvedValue(300)
    const { result } = renderHook(() => useRebootGraceMs())
    expect(result.current).toBe(DEFAULT_REBOOT_GRACE_MS)
    await waitFor(() => expect(result.current).toBe(300_000))
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('keeps the default when the fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('forbidden'))
    const { result } = renderHook(() => useRebootGraceMs())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(DEFAULT_REBOOT_GRACE_MS)
  })

  it('ignores a non-positive or non-finite value', async () => {
    mockGet.mockResolvedValue(0)
    const { result } = renderHook(() => useRebootGraceMs())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(DEFAULT_REBOOT_GRACE_MS)
  })
})
