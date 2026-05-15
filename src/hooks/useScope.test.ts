// SPDX-License-Identifier: Apache-2.0

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canAdminGroup, isGlobalAdmin, roleOnGroup, useScope } from './useScope'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useScope', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) =>
      (fetchMock as unknown as typeof fetch)(input, init),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the scope on mount', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ global: 'admin', groups: { 'g-1': 'operator' } }),
    )
    const { result } = renderHook(() => useScope())
    expect(result.current.state.kind).toBe('loading')
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    if (result.current.state.kind !== 'ready') throw new Error('expected ready')
    expect(result.current.state.scope.global).toBe('admin')
  })

  it('captures error on fetch failure', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    const { result } = renderHook(() => useScope())
    await waitFor(() => expect(result.current.state.kind).toBe('error'))
  })

  it('helpers return false while loading', () => {
    expect(isGlobalAdmin({ kind: 'loading' })).toBe(false)
    expect(canAdminGroup({ kind: 'loading' }, 'g')).toBe(false)
    expect(roleOnGroup({ kind: 'loading' }, 'g')).toBe('')
  })

  it('helpers reflect the loaded scope', () => {
    const ready = {
      kind: 'ready' as const,
      scope: { global: 'operator' as const, groups: { g1: 'admin' as const } },
    }
    expect(isGlobalAdmin(ready)).toBe(false)
    expect(canAdminGroup(ready, 'g1')).toBe(true)
    expect(canAdminGroup(ready, 'g2')).toBe(false)
    expect(roleOnGroup(ready, 'g1')).toBe('admin')
    expect(roleOnGroup(ready, 'missing')).toBe('')
  })

  it('global admin always admins any group', () => {
    const ready = {
      kind: 'ready' as const,
      scope: { global: 'admin' as const, groups: {} },
    }
    expect(canAdminGroup(ready, 'any')).toBe(true)
    expect(isGlobalAdmin(ready)).toBe(true)
  })

  it('skips the fetch when userKey is null and stays in loading', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ global: 'admin', groups: {} }))
    const { result } = renderHook(() => useScope(null))
    // Give any pending effect a turn so we'd catch an accidental
    // fetch firing despite the null key.
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.state.kind).toBe('loading')
  })

  it('refetches when userKey changes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ global: 'admin', groups: {} }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ global: '', groups: { 'g-1': 'auditor' } }),
      )
    const { result, rerender } = renderHook(
      ({ userKey }: { userKey: string | null }) => useScope(userKey),
      { initialProps: { userKey: 'u1' } },
    )
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    if (result.current.state.kind !== 'ready') throw new Error('expected ready')
    expect(result.current.state.scope.global).toBe('admin')

    rerender({ userKey: 'u2' })
    await waitFor(() => {
      if (result.current.state.kind !== 'ready') return
      expect(result.current.state.scope.global).toBe('')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resets to loading when userKey transitions to null', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ global: 'admin', groups: {} }),
    )
    const initialProps: { userKey: string | null } = { userKey: 'u1' }
    const { result, rerender } = renderHook(
      ({ userKey }: { userKey: string | null }) => useScope(userKey),
      { initialProps },
    )
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    rerender({ userKey: null })
    expect(result.current.state.kind).toBe('loading')
  })
})
