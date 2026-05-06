// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTheme } from './useTheme'

const DARK_CLASS = 'pf-v6-theme-dark'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove(DARK_CLASS)
  })

  afterEach(() => {
    document.documentElement.classList.remove(DARK_CLASS)
  })

  it('defaults to dark when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('dark')
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true)
    expect(localStorage.getItem('cw-theme')).toBe('dark')
  })

  it('reads stored preference', () => {
    localStorage.setItem('cw-theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('light')
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false)
  })

  it('toggling updates the DOM class and storage', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('light'))
    expect(result.current[0]).toBe('light')
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false)
    expect(localStorage.getItem('cw-theme')).toBe('light')

    act(() => result.current[1]('dark'))
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true)
    expect(localStorage.getItem('cw-theme')).toBe('dark')
  })

  it('ignores stored values that are not "light" or "dark"', () => {
    localStorage.setItem('cw-theme', 'rainbow')
    const { result } = renderHook(() => useTheme())
    expect(result.current[0]).toBe('dark')
  })
})
