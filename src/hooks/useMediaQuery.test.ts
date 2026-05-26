// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

type Listener = (e: MediaQueryListEvent) => void

function installMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: initial,
    media: '',
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    dispatch: (next: boolean) => {
      mql.matches = next
      listeners.forEach((fn) => fn({ matches: next } as MediaQueryListEvent))
    },
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return mql
}

describe('useMediaQuery', () => {
  let mql: ReturnType<typeof installMatchMedia>

  beforeEach(() => {
    mql = installMatchMedia(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the initial match state', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 90.625rem)'))
    expect(result.current).toBe(false)
  })

  it('updates when the media-query result changes', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 90.625rem)'))
    act(() => mql.dispatch(true))
    expect(result.current).toBe(true)
    act(() => mql.dispatch(false))
    expect(result.current).toBe(false)
  })
})
