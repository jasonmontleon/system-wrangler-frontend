// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserSessionsCard from './UserSessionsCard'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const row = {
  id: 'bob-sid',
  label: 'Chrome on Windows',
  ip: '10.0.0.9',
  createdAt: '2026-05-30T12:00:00Z',
  lastSeenAt: '2026-05-31T12:00:00Z',
  expiresAt: '2026-06-29T12:00:00Z',
  current: false,
}

describe('UserSessionsCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the admin path for the target user', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([row]))
    render(<UserSessionsCard userId="bob-id" username="bob" />)
    await waitFor(() => {
      expect(screen.getByText('Chrome on Windows')).toBeInTheDocument()
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/users/bob-id/sessions')
  })

  it('shows the empty state', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<UserSessionsCard userId="bob-id" username="bob" />)
    await waitFor(() => {
      expect(screen.getByText(/no active sessions/i)).toBeInTheDocument()
    })
  })

  it('revokes a session via the admin path', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([row]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))
    render(<UserSessionsCard userId="bob-id" username="bob" />)
    await waitFor(() => {
      expect(screen.getByText('Chrome on Windows')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    await waitFor(() => {
      expect(screen.queryByText('Chrome on Windows')).not.toBeInTheDocument()
    })
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/admin/users/bob-id/sessions/bob-sid',
    )
  })

  it('surfaces a list error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    render(<UserSessionsCard userId="bob-id" username="bob" />)
    await waitFor(() => {
      expect(screen.getByText(/forbidden/i)).toBeInTheDocument()
    })
  })

  it('surfaces a revoke error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([row]))
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
    render(<UserSessionsCard userId="bob-id" username="bob" />)
    await waitFor(() => {
      expect(screen.getByText('Chrome on Windows')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument()
    })
  })
})
