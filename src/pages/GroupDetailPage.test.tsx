// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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

// renderRoute renders the detail page under a MemoryRouter at the
// supplied path, with the route declared so useParams returns the
// expected groupId. Defaults to "/groups/g-1" so each test doesn't
// have to repeat it.
function renderRoute(path = '/groups/g-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
        <Route path="/groups" element={<div>System Groups list</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('GroupDetailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    // The page fans out to three endpoints before showing anything:
    // /api/me/scope (scope), /api/groups/g-1 (this group), and
    // /api/systems (members). The first two have a stable default;
    // tests only configure the systems list (and any follow-up
    // mutations) through fetchMock.
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      if (url.startsWith('/api/me/scope')) {
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      }
      if (url === '/api/groups/g-1') {
        return Promise.resolve(jsonResponse(sampleGroup))
      }
      return (fetchMock as unknown as typeof fetch)(input, init)
    })
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('row kebab Check fans out per enabled updater on a member', async () => {
    const checks: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            system({ id: 's-1', name: 'member', groupId: 'g-1' }),
          ]),
        )
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/))
        return Promise.resolve(
          jsonResponse({
            updaters: [
              {
                updaterId: 'builtin.dnf',
                source: 'builtin',
                displayName: 'dnf',
                installed: true,
                enabled: true,
              },
            ],
          }),
        )
      if (url.endsWith('/check') && method === 'POST') {
        checks.push(url)
        return Promise.resolve(
          jsonResponse({
            runId: 'r',
            updaterId: 'builtin.dnf',
            kind: 'check',
            status: 'success',
            exitCode: 0,
            affectedCount: 0,
            durationMs: 1,
          }),
        )
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)

    renderRoute()
    const row = (await screen.findByText('member')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Check$/i }))
    await waitFor(() => expect(checks).toHaveLength(1))
    expect(checks[0]).toContain('/systems/s-1/updaters/builtin.dnf/check')
    expect(
      await screen.findByLabelText(/Updater action results/i),
    ).toBeInTheDocument()
  })

  it('bulk Update selected opens confirm and fires apply on confirm', async () => {
    const applies: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            system({ id: 's-1', name: 'host-a', groupId: 'g-1' }),
          ]),
        )
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/))
        return Promise.resolve(
          jsonResponse({
            updaters: [
              {
                updaterId: 'builtin.dnf',
                source: 'builtin',
                displayName: 'dnf',
                installed: true,
                enabled: true,
              },
            ],
          }),
        )
      if (url.endsWith('/apply') && method === 'POST') {
        applies.push(url)
        return Promise.resolve(
          jsonResponse({
            runId: 'r',
            updaterId: 'builtin.dnf',
            kind: 'apply',
            status: 'success',
            exitCode: 0,
            affectedCount: 3,
            durationMs: 1,
          }),
        )
      }
      if (url.endsWith('/check') && method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            runId: 'r2',
            updaterId: 'builtin.dnf',
            kind: 'check',
            status: 'success',
            exitCode: 0,
            affectedCount: 0,
            durationMs: 1,
          }),
        )
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)

    renderRoute()
    await screen.findByText('host-a')
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select row/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Update selected/i }))
    expect(applies).toHaveLength(0)
    expect(await screen.findByText(/Update 1 system\?/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Update$/i }))
    await waitFor(() => expect(applies).toHaveLength(1))
  })

  it('shows only systems whose groupId matches', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: 's-1', name: 'member', groupId: 'g-1' }),
        system({ id: 's-2', name: 'orphan' }),
      ]),
    )
    renderRoute()
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
    renderRoute()
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
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [
            { userId: 'u1', username: 'alice', groupId: 'g-1', role: 'admin' },
          ],
        }),
      )
    renderRoute()
    fireEvent.click(await screen.findByRole('tab', { name: /^roles$/i }))
    expect(await screen.findByText('alice')).toBeInTheDocument()
  })

  it('users without any group role do not see the Roles tab', async () => {
    // Override the default scope: a caller with a role on a different
    // group can still see this group (Global Admin), but per
    // research/rbac.md the Roles tab is for callers with a role on
    // *this* specific group.
    vi.unstubAllGlobals()
    const fetchMock2 = vi.fn()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      if (url.startsWith('/api/me/scope')) {
        return Promise.resolve(
          jsonResponse({ global: '', groups: { 'other-group': 'auditor' } }),
        )
      }
      if (url === '/api/groups/g-1') {
        return Promise.resolve(jsonResponse(sampleGroup))
      }
      return (fetchMock2 as unknown as typeof fetch)(input, init)
    })
    fetchMock2.mockResolvedValueOnce(jsonResponse([]))
    renderRoute()
    await screen.findByText(/no systems in this group/i)
    expect(screen.queryByRole('tab', { name: /^roles$/i })).toBeNull()
  })

  it('the breadcrumb is a Link back to /groups', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    renderRoute()
    await screen.findByText(/no systems in this group/i)
    const link = screen.getByRole('link', { name: 'System Groups' })
    expect(link.getAttribute('href')).toBe('/groups')
  })

  it('surfaces a not-found message when the group fetch 404s', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput) => {
      const url = String(input)
      if (url.startsWith('/api/me/scope')) {
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      }
      if (url === '/api/groups/g-1') {
        return Promise.resolve(jsonResponse({ error: 'group not found' }, 404))
      }
      return Promise.resolve(jsonResponse([]))
    })
    renderRoute()
    expect(await screen.findByText(/group not found/i)).toBeInTheDocument()
  })
})
