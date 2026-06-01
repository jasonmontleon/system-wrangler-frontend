// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SessionsCard from './SessionsCard'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const current = {
  id: 's-current',
  label: 'Firefox on Linux',
  ip: '10.0.0.5',
  createdAt: '2026-06-01T12:00:00Z',
  lastSeenAt: '2026-06-01T12:00:00Z',
  expiresAt: '2026-07-01T12:00:00Z',
  current: true,
}

const other = {
  id: 's-other',
  label: 'Chrome on Windows',
  ip: '10.0.0.9',
  createdAt: '2026-05-30T12:00:00Z',
  lastSeenAt: '2026-05-31T12:00:00Z',
  expiresAt: '2026-06-29T12:00:00Z',
  current: false,
}

describe('SessionsCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the empty state when there are no sessions', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<SessionsCard />)
    await waitFor(() => {
      expect(screen.getByText(/no active sessions/i)).toBeInTheDocument()
    })
  })

  it('flags the current session and only the others get a revoke button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([current, other]))
    render(<SessionsCard />)
    await waitFor(() => {
      expect(screen.getByText('Firefox on Linux')).toBeInTheDocument()
    })
    expect(screen.getByText('This browser')).toBeInTheDocument()
    // Only the non-current row exposes Revoke.
    const revokeButtons = screen.getAllByRole('button', { name: /^revoke$/i })
    expect(revokeButtons).toHaveLength(1)
  })

  it('revokes another session', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([current, other]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([current]))
    render(<SessionsCard />)
    await waitFor(() => {
      expect(screen.getByText('Chrome on Windows')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    await waitFor(() => {
      expect(screen.queryByText('Chrome on Windows')).not.toBeInTheDocument()
    })
    // The revoke DELETE went to the right session id.
    const url = fetchMock.mock.calls[1][0] as string
    expect(url).toBe('/api/auth/sessions/s-other')
  })

  it('signs out everywhere else and hides the button when no others remain', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([current, other]))
      .mockResolvedValueOnce(jsonResponse({ revoked: 1 }))
      .mockResolvedValueOnce(jsonResponse([current]))
    render(<SessionsCard />)
    const btn = await screen.findByRole('button', {
      name: /sign out everywhere else/i,
    })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /sign out everywhere else/i }),
      ).not.toBeInTheDocument()
    })
    const url = fetchMock.mock.calls[1][0] as string
    expect(url).toBe('/api/auth/sessions/revoke-others')
  })

  it('does not offer sign-out-everywhere when only the current session exists', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([current]))
    render(<SessionsCard />)
    await waitFor(() => {
      expect(screen.getByText('Firefox on Linux')).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: /sign out everywhere else/i }),
    ).not.toBeInTheDocument()
  })

  it('surfaces a list error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500))
    render(<SessionsCard />)
    await waitFor(() => {
      expect(screen.getByText(/down/i)).toBeInTheDocument()
    })
  })

  it('surfaces a revoke error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([current, other]))
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
    render(<SessionsCard />)
    await waitFor(() => {
      expect(screen.getByText('Chrome on Windows')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument()
    })
  })
})
