// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UndecryptableSecretsBanner from './UndecryptableSecretsBanner'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('UndecryptableSecretsBanner', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when count is zero', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ count: 0, items: [] }))
    const { container } = render(<UndecryptableSecretsBanner />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(container.querySelector('.pf-v6-c-alert')).toBeNull()
  })

  it('renders rows and the singular title for one affected secret', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 1,
        items: [
          {
            kind: 'user_totp',
            field: 'secret',
            targetId: 'u1',
            targetLabel: 'alice',
            keyVersion: 4242,
          },
        ],
      }),
    )
    render(<UndecryptableSecretsBanner />)
    expect(
      await screen.findByText(/1 encrypted secret cannot be decrypted/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/alice/)).toBeInTheDocument()
    expect(screen.getByText(/authenticator secret/)).toBeInTheDocument()
    expect(screen.getByText(/4242/)).toBeInTheDocument()
  })

  it('renders the plural title and labels both TOTP fields', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 2,
        items: [
          {
            kind: 'user_totp',
            field: 'pending',
            targetId: 'u1',
            targetLabel: 'alice',
            keyVersion: 1,
          },
          {
            kind: 'user_totp',
            field: 'secret',
            targetId: 'u2',
            targetLabel: 'bob',
            keyVersion: 1,
          },
        ],
      }),
    )
    render(<UndecryptableSecretsBanner />)
    expect(
      await screen.findByText(/2 encrypted secrets cannot be decrypted/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/pending TOTP enrollment/)).toBeInTheDocument()
    expect(screen.getByText(/authenticator secret/)).toBeInTheDocument()
  })

  it('falls back to "kind / field" for unknown source kinds', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 1,
        items: [
          {
            kind: 'system_ssh_key',
            field: 'private',
            targetId: 'h1',
            targetLabel: 'web-1',
            keyVersion: 7,
          },
        ],
      }),
    )
    render(<UndecryptableSecretsBanner />)
    expect(
      await screen.findByText(/system_ssh_key \/ private/i),
    ).toBeInTheDocument()
  })

  it('renders the action link and calls onNavigateToUsers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 1,
        items: [
          {
            kind: 'user_totp',
            field: 'secret',
            targetId: 'u1',
            targetLabel: 'alice',
            keyVersion: 1,
          },
        ],
      }),
    )
    const onNav = vi.fn()
    render(<UndecryptableSecretsBanner onNavigateToUsers={onNav} />)
    const link = await screen.findByRole('button', { name: /open users page/i })
    fireEvent.click(link)
    expect(onNav).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when the request fails (403 race / network)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'scan requires Global Admin' }, 403),
    )
    const { container } = render(<UndecryptableSecretsBanner />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(container.querySelector('.pf-v6-c-alert')).toBeNull()
  })
})
