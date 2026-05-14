// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupDetailPage from './GroupDetailPage'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function system(overrides: Partial<{
  id: string
  name: string
  hostname: string
  groupId: string | null
}> = {}) {
  return {
    id: 's-1',
    name: 'sys-1',
    hostname: '10.0.0.1',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'unprobed' as const,
    ...overrides,
  }
}

const sampleGroup = {
  id: 'g-1',
  name: 'prod',
  createdAt: '2026-01-01T00:00:00Z',
  systemCount: 0,
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

describe('GroupDetailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      // GroupDetailPage now fetches the caller's scope via /api/me/scope
      // alongside the systems list. Tests that only care about systems
      // shouldn't have to mock it; default to "Global Admin" so the UI
      // shows every control.
      if (String(input).startsWith('/api/me/scope')) {
        return Promise.resolve(
          new Response(JSON.stringify({ global: 'admin', groups: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return (fetchMock as unknown as typeof fetch)(input, init)
    })
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows only systems whose groupId matches', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: 's-1', name: 'member', groupId: 'g-1' }),
        system({ id: 's-2', name: 'orphan' }),
      ]),
    )
    render(<GroupDetailPage group={sampleGroup} onBack={() => {}} />)
    expect(await screen.findByText('member')).toBeInTheDocument()
    expect(screen.queryByText('orphan')).not.toBeInTheDocument()
  })

  it('the Add Systems modal lists only ungrouped systems', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          system({ id: 's-1', name: 'free' }),
          system({ id: 's-2', name: 'taken', groupId: 'g-1' }),
          system({ id: 's-3', name: 'elsewhere', groupId: 'other' }),
        ]),
      )
      // Assign call + refetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse([
          system({ id: 's-1', name: 'free', groupId: 'g-1' }),
          system({ id: 's-2', name: 'taken', groupId: 'g-1' }),
          system({ id: 's-3', name: 'elsewhere', groupId: 'other' }),
        ]),
      )
    render(<GroupDetailPage group={sampleGroup} onBack={() => {}} />)
    await screen.findByText('taken')
    fireEvent.click(screen.getByRole('button', { name: /^actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /add systems/i }))
    const modal = await screen.findByRole('dialog', { name: /add systems to prod/i })
    // 'free' is the only ungrouped system; the others must not appear.
    expect(within(modal).getByText(/free \(10\.0\.0\.1\)/)).toBeInTheDocument()
    expect(within(modal).queryByText(/taken/)).not.toBeInTheDocument()
    expect(within(modal).queryByText(/elsewhere/)).not.toBeInTheDocument()
    fireEvent.click(within(modal).getByLabelText(/free \(10\.0\.0\.1\)/))
    fireEvent.click(within(modal).getByRole('button', { name: /^add/i }))
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => [
        c[0],
        (c[1] as RequestInit | undefined)?.method ?? 'GET',
      ])
      expect(calls).toContainEqual(['/api/systems/s-1/group', 'PUT'])
    })
  })

  it('Global Admin sees the Roles tab and can switch to it', async () => {
    // The default scope mock in beforeEach is "global admin", which is
    // exactly what we need. Just provide the systems + role-assignments
    // response for the tab content.
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [
            { userId: 'u1', username: 'alice', groupId: 'g-1', role: 'admin' },
          ],
        }),
      )
    render(<GroupDetailPage group={sampleGroup} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: /^roles$/i }))
    expect(await screen.findByText('alice')).toBeInTheDocument()
  })

  it('users without any group role do not see the Roles tab', async () => {
    // Override the default scope: a Global Auditor sees the group itself
    // (any global role can see all groups) but per research/rbac.md the
    // Roles tab is for callers with a role on this specific group.
    // Actually a Global Auditor IS a global role, so they would see the
    // tab. Use a user with a role on a DIFFERENT group instead.
    vi.unstubAllGlobals()
    const fetchMock2 = vi.fn()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      if (String(input).startsWith('/api/me/scope')) {
        return Promise.resolve(
          jsonResponse({ global: '', groups: { 'other-group': 'auditor' } }),
        )
      }
      return (fetchMock2 as unknown as typeof fetch)(input, init)
    })
    fetchMock2.mockResolvedValueOnce(jsonResponse([]))
    render(<GroupDetailPage group={sampleGroup} onBack={() => {}} />)
    await screen.findByText(/no systems in this group/i)
    expect(screen.queryByRole('tab', { name: /^roles$/i })).toBeNull()
  })

  it('clicking the breadcrumb back invokes onBack', async () => {
    const onBack = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<GroupDetailPage group={sampleGroup} onBack={onBack} />)
    await screen.findByText(/no systems in this group/i)
    fireEvent.click(screen.getByText('System Groups'))
    expect(onBack).toHaveBeenCalled()
  })
})
