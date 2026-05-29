// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CredentialsPage from './CredentialsPage'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('CredentialsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the global editor and the overview table', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/admin/ansible-credentials/global') {
        return Promise.resolve(
          jsonResponse({
            scopeKind: 'global',
            ansibleUser: 'ansible',
            publicKey: 'ssh-ed25519 AAAA',
            origin: 'sw_generated',
            createdAt: '2026-05-15T00:00:00Z',
            updatedAt: '2026-05-15T00:00:00Z',
          }),
        )
      }
      if (url === '/api/admin/ansible-credentials') {
        return Promise.resolve(
          jsonResponse({
            slots: [
              {
                scopeKind: 'global',
                ansibleUser: 'ansible',
                publicKey: 'ssh-ed25519 AAAA',
                origin: 'sw_generated',
                createdAt: '2026-05-15T00:00:00Z',
                updatedAt: '2026-05-15T00:00:00Z',
              },
              {
                scopeKind: 'group',
                scopeId: 'g-1',
                ansibleUser: 'deploy',
                createdAt: '2026-05-15T00:00:00Z',
                updatedAt: '2026-05-15T00:00:00Z',
              },
            ],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, { status: 500 }))
    })
    render(<CredentialsPage />)
    await waitFor(() => expect(screen.getByText('Ansible Credentials')).toBeInTheDocument())
    expect(await screen.findByText(/Ansible user: ansible/i)).toBeInTheDocument()
    expect(await screen.findByText('g-1')).toBeInTheDocument()
    expect(screen.getByText('group')).toBeInTheDocument()
    expect(screen.getByText('deploy')).toBeInTheDocument()
  })

  it('renders the empty-state alert when no slots exist', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/admin/ansible-credentials/global') {
        return Promise.resolve(jsonResponse({ error: 'none' }, { status: 404 }))
      }
      if (url === '/api/admin/ansible-credentials') {
        return Promise.resolve(jsonResponse({ slots: [] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, { status: 500 }))
    })
    render(<CredentialsPage />)
    expect(
      await screen.findByText(/No credential slots configured anywhere/i),
    ).toBeInTheDocument()
  })

  it('renders system-scope slots with user-supplied and configured origins', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/admin/ansible-credentials/global') {
        return Promise.resolve(jsonResponse({ error: 'none' }, { status: 404 }))
      }
      if (url === '/api/admin/ansible-credentials') {
        return Promise.resolve(
          jsonResponse({
            slots: [
              {
                scopeKind: 'system',
                scopeId: 'sys-1',
                ansibleUser: 'opsy',
                publicKey: 'ssh-ed25519 USER',
                origin: 'user_supplied',
                createdAt: '2026-05-15T00:00:00Z',
                updatedAt: '2026-05-15T00:00:00Z',
              },
              {
                scopeKind: 'system',
                scopeId: 'sys-2',
                ansibleUser: 'opsy',
                publicKey: 'ssh-ed25519 CFG',
                // origin falls through originLabel's default branch
                origin: 'externally_managed' as unknown as 'user_supplied',
                createdAt: '2026-05-15T00:00:00Z',
                updatedAt: '2026-05-15T00:00:00Z',
              },
            ],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, { status: 500 }))
    })
    render(<CredentialsPage />)
    expect(await screen.findByText('sys-1')).toBeInTheDocument()
    expect(screen.getByText('sys-2')).toBeInTheDocument()
    expect(screen.getByText(/user-supplied/i)).toBeInTheDocument()
    expect(screen.getByText(/^configured$/i)).toBeInTheDocument()
  })

  it('shows an error alert when the list call fails', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/admin/ansible-credentials/global') {
        return Promise.resolve(jsonResponse({ error: 'none' }, { status: 404 }))
      }
      if (url === '/api/admin/ansible-credentials') {
        return Promise.resolve(jsonResponse({ error: 'boom' }, { status: 500 }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, { status: 500 }))
    })
    render(<CredentialsPage />)
    expect(
      await screen.findByText(/Could not load credential slots/i),
    ).toBeInTheDocument()
  })
})
