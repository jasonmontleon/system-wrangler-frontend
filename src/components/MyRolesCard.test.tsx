// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MyRolesCard from './MyRolesCard'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('MyRolesCard', () => {
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

  it('renders global and group rows from /api/me/scope', async () => {
    fetchMock.mockImplementation((input: FetchInput) => {
      if (String(input) === '/api/me/scope') {
        return Promise.resolve(
          jsonResponse({ global: 'operator', groups: { g1: 'auditor' } }),
        )
      }
      if (String(input) === '/api/groups') {
        return Promise.resolve(
          jsonResponse([{ id: 'g1', name: 'prod', createdAt: '', systemCount: 0 }]),
        )
      }
      return Promise.reject(new Error('unexpected fetch ' + String(input)))
    })
    render(<MyRolesCard />)
    expect(await screen.findByText(/global \(install-wide\)/i)).toBeInTheDocument()
    expect(screen.getByText('Operator')).toBeInTheDocument()
    expect(screen.getByText(/group: prod/i)).toBeInTheDocument()
    expect(screen.getByText('Auditor')).toBeInTheDocument()
  })

  it('falls back to the group id when group lookup fails', async () => {
    fetchMock.mockImplementation((input: FetchInput) => {
      if (String(input) === '/api/me/scope') {
        return Promise.resolve(
          jsonResponse({ global: '', groups: { 'mystery-id': 'admin' } }),
        )
      }
      return Promise.resolve(jsonResponse({ error: 'forbidden' }, 403))
    })
    render(<MyRolesCard />)
    expect(await screen.findByText(/group: mystery-id/i)).toBeInTheDocument()
  })

  it('shows empty state when the caller has no access', async () => {
    fetchMock.mockImplementation((input: FetchInput) => {
      if (String(input) === '/api/me/scope') {
        return Promise.resolve(jsonResponse({ global: '', groups: {} }))
      }
      return Promise.resolve(jsonResponse([]))
    })
    render(<MyRolesCard />)
    expect(await screen.findByText(/no access/i)).toBeInTheDocument()
  })

  it('surfaces an error when /api/me/scope fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500))
    render(<MyRolesCard />)
    expect(await screen.findByText(/could not load roles/i)).toBeInTheDocument()
  })
})
