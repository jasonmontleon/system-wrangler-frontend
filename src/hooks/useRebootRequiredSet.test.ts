// SPDX-License-Identifier: Apache-2.0

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRebootRequiredSet } from './useRebootRequiredSet'
import { queryRebootRequiredSet } from '../util/rebootSignal'

vi.mock('../util/rebootSignal', () => ({
  queryRebootRequiredSet: vi.fn(),
}))

const mockQuery = vi.mocked(queryRebootRequiredSet)

describe('useRebootRequiredSet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockQuery.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches the set once on mount', async () => {
    mockQuery.mockResolvedValue(new Set(['a', 'b']))
    const { result } = renderHook(() => useRebootRequiredSet())
    await vi.waitFor(() => expect(result.current.has('a')).toBe(true))
    expect(result.current.has('b')).toBe(true)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('re-polls on the interval and reflects a cleared gauge without a remount', async () => {
    mockQuery.mockResolvedValueOnce(new Set(['a']))
    const { result } = renderHook(() => useRebootRequiredSet())
    await vi.waitFor(() => expect(result.current.has('a')).toBe(true))

    // The system rebooted: the next scrape reports an empty gauge.
    mockQuery.mockResolvedValueOnce(new Set())
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(result.current.size).toBe(0))
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good set when a poll rejects', async () => {
    mockQuery.mockResolvedValueOnce(new Set(['a']))
    const { result } = renderHook(() => useRebootRequiredSet())
    await vi.waitFor(() => expect(result.current.has('a')).toBe(true))

    mockQuery.mockRejectedValueOnce(new Error('prometheus down'))
    await vi.advanceTimersByTimeAsync(30_000)
    // Last good set survives the failed scrape.
    expect(result.current.has('a')).toBe(true)
  })

  it('stops polling after unmount', async () => {
    mockQuery.mockResolvedValue(new Set())
    const { unmount } = renderHook(() => useRebootRequiredSet())
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1))
    unmount()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})
