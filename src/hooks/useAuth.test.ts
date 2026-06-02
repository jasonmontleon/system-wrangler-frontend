// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './useAuth'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useAuth', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts in loading then transitions to ready after status fetch', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ setupRequired: false, authenticated: false }),
    )
    const { result } = renderHook(() => useAuth())
    expect(result.current.state.kind).toBe('loading')
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready')
    })
  })

  it('records error state when /api/auth/status fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => {
      expect(result.current.state.kind).toBe('error')
    })
  })

  it('setup posts to /api/auth/setup and refreshes status', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ setupRequired: true, authenticated: false }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          setupRequired: false,
          authenticated: true,
          user: { id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' },
        }),
      )

    const { result } = renderHook(() => useAuth())
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready')
    })

    await act(async () => {
      await result.current.setup('admin', 'correctpassword')
    })
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready')
    })
    if (result.current.state.kind === 'ready') {
      expect(result.current.state.status.authenticated).toBe(true)
    }
    const calls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calls).toContain('/api/auth/setup')
  })

  it('login + logout exercise both endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ setupRequired: false, authenticated: false }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          setupRequired: false,
          authenticated: true,
          user: { id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ setupRequired: false, authenticated: false }),
      )

    const { result } = renderHook(() => useAuth())
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready')
    })

    await act(async () => {
      await result.current.login('admin', 'correctpassword')
    })
    await act(async () => {
      await result.current.logout()
    })

    const calls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calls).toContain('/api/auth/login')
    expect(calls).toContain('/api/auth/logout')
  })

  it('logout navigates to the IdP when given a logoutUrl', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ setupRequired: false, authenticated: false }),
      )
      .mockResolvedValueOnce(jsonResponse({ logoutUrl: 'https://idp/logout' }))

    const assign = vi.fn()
    const orig = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...orig, assign },
    })
    try {
      const { result } = renderHook(() => useAuth())
      await waitFor(() => {
        expect(result.current.state.kind).toBe('ready')
      })
      await act(async () => {
        await result.current.logout()
      })
      expect(assign).toHaveBeenCalledWith('https://idp/logout')
      // No status refresh after an IdP redirect: status + logout only.
      const calls = fetchMock.mock.calls.map((c) => String(c[0]))
      expect(calls.filter((u) => u.endsWith('/api/auth/status'))).toHaveLength(1)
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: orig,
      })
    }
  })

  it('login skips refresh when totp is required', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ setupRequired: false, authenticated: false }),
      )
      .mockResolvedValueOnce(jsonResponse({ totpRequired: true }))

    const { result } = renderHook(() => useAuth())
    await waitFor(() => {
      expect(result.current.state.kind).toBe('ready')
    })

    let kind: string | undefined
    await act(async () => {
      const r = await result.current.login('admin', 'correctpassword')
      kind = r.kind
    })
    expect(kind).toBe('totp')
    // /status was called exactly once on mount; the login that returned
    // totpRequired must not have triggered a second /status round-trip.
    const statusCalls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u === '/api/auth/status')
    expect(statusCalls).toHaveLength(1)
  })
})
