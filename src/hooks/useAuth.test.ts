// SPDX-License-Identifier: AGPL-3.0-or-later

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
})
