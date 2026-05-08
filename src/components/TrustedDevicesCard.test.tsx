// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedDevicesCard from './TrustedDevicesCard'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('TrustedDevicesCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the empty state when there are no devices', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<TrustedDevicesCard />)
    await waitFor(() => {
      expect(screen.getByText(/no trusted browsers/i)).toBeInTheDocument()
    })
  })

  it('renders devices and revokes one', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'd1',
            label: 'Firefox on Linux',
            createdAt: '2026-05-06T12:00:00Z',
            lastUsedAt: '2026-05-06T12:00:00Z',
            expiresAt: '2026-06-05T12:00:00Z',
          },
          {
            id: 'd2',
            label: 'Safari on iOS',
            createdAt: '2026-05-05T12:00:00Z',
            lastUsedAt: '2026-05-05T12:00:00Z',
            expiresAt: '2026-06-04T12:00:00Z',
          },
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'd2',
            label: 'Safari on iOS',
            createdAt: '2026-05-05T12:00:00Z',
            lastUsedAt: '2026-05-05T12:00:00Z',
            expiresAt: '2026-06-04T12:00:00Z',
          },
        ]),
      )

    render(<TrustedDevicesCard />)
    await waitFor(() => {
      expect(screen.getByText('Firefox on Linux')).toBeInTheDocument()
      expect(screen.getByText('Safari on iOS')).toBeInTheDocument()
    })
    const revokeButtons = screen.getAllByRole('button', { name: /revoke/i })
    expect(revokeButtons).toHaveLength(2)
    fireEvent.click(revokeButtons[0])
    await waitFor(() => {
      expect(screen.queryByText('Firefox on Linux')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument()
  })

  it('surfaces an error from the list call', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500))
    render(<TrustedDevicesCard />)
    await waitFor(() => {
      expect(screen.getByText(/down/i)).toBeInTheDocument()
    })
  })

  it('surfaces an error from the revoke call', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'd1',
            label: 'Firefox on Linux',
            createdAt: '2026-05-06T12:00:00Z',
            lastUsedAt: '2026-05-06T12:00:00Z',
            expiresAt: '2026-06-05T12:00:00Z',
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))

    render(<TrustedDevicesCard />)
    await waitFor(() => {
      expect(screen.getByText('Firefox on Linux')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument()
    })
  })
})
