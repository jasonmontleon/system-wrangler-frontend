// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTheme } from './useTheme'

const DARK_CLASS = 'pf-v6-theme-dark'

describe('useTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove(DARK_CLASS)
  })

  afterEach(() => {
    document.documentElement.classList.remove(DARK_CLASS)
  })

  it('defaults to dark when no server theme is provided', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('dark')
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true)
  })

  it('adopts the server-stored theme when provided', () => {
    const { result, rerender } = renderHook(
      ({ st }: { st?: string }) => useTheme(st),
      { initialProps: { st: undefined as string | undefined } },
    )
    expect(result.current[0]).toBe('dark')
    rerender({ st: 'light' })
    expect(result.current[0]).toBe('light')
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false)
  })

  it('reverts to dark when the server theme is cleared (e.g. on logout)', () => {
    const { result, rerender } = renderHook(
      ({ st }: { st?: string }) => useTheme(st),
      { initialProps: { st: 'light' as string | undefined } },
    )
    expect(result.current[0]).toBe('light')
    rerender({ st: undefined })
    expect(result.current[0]).toBe('dark')
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true)
  })

  it('ignores server theme strings that are not light or dark', () => {
    const { result } = renderHook(() => useTheme('neon'))
    expect(result.current[0]).toBe('dark')
  })
})
