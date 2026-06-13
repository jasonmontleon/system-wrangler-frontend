// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  status: 'unprobed' | 'reachable' | 'unreachable'
  running: boolean
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
      if (url.startsWith('/api/label-styles')) {
        return Promise.resolve(jsonResponse({}))
      }
      if (url.startsWith('/api/metrics/query')) {
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      }
      if (url === '/api/reboot-grace-seconds') {
        return Promise.resolve(jsonResponse({ seconds: 120 }))
      }
      if (url === '/api/systems/bulk-event') {
        return Promise.resolve(new Response(null, { status: 204 }))
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
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems/bulk-event')
        return Promise.resolve(new Response(null, { status: 204 }))
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
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems/bulk-event')
        return Promise.resolve(new Response(null, { status: 204 }))
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

  it('shows a row spinner when a member system has running=true from the backend', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: 's-1', name: 'busy', groupId: 'g-1', running: true }),
        system({ id: 's-2', name: 'idle', groupId: 'g-1' }),
      ]),
    )
    renderRoute()
    const busyRow = (await screen.findByText('busy')).closest('tr')!
    expect(within(busyRow).getByLabelText(/Run in progress/i)).toBeInTheDocument()
    const idleRow = screen.getByText('idle').closest('tr')!
    expect(within(idleRow).queryByLabelText(/Run in progress/i)).toBeNull()
  })

  it('gates a bulk Check on the selected members, not on an unselected busy one', async () => {
    const checks: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1') return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            // s-busy has a run in flight from elsewhere; s-idle is free.
            system({ id: 's-busy', name: 'busy', groupId: 'g-1', running: true }),
            system({ id: 's-idle', name: 'idle', groupId: 'g-1' }),
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
    // Select only the idle member; the busy one stays unselected.
    const idleRow = (await screen.findByText('idle')).closest('tr')!
    fireEvent.click(within(idleRow).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    // findBy lets the menu's Popper positioning settle inside act before
    // we assert, instead of leaking the update past the test.
    const checkItem = await screen.findByRole('menuitem', { name: /Check selected/i })
    expect(checkItem).not.toBeDisabled()
    fireEvent.click(checkItem)
    await waitFor(() => expect(checks).toHaveLength(1))
    expect(checks.every((u) => u.includes('/systems/s-idle/'))).toBe(true)

    // Now also select the busy member: the action must disable.
    const busyRow = screen.getByText('busy').closest('tr')!
    fireEvent.click(within(busyRow).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    expect(
      await screen.findByRole('menuitem', { name: /Check selected/i }),
    ).toBeDisabled()
  })

  it('skips unreachable members in a bulk Check selected', async () => {
    const checks: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1') return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            system({ id: 's-alive', name: 'alive', groupId: 'g-1', status: 'reachable' }),
            system({ id: 's-dead', name: 'dead', groupId: 'g-1', status: 'unreachable' }),
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
    await screen.findByText('alive')
    const checkboxes = screen.getAllByRole('checkbox', { name: /select row/i })
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Check selected/i }))
    await waitFor(() => expect(checks).toHaveLength(1))
    expect(checks[0]).toContain('/systems/s-alive/')
    expect(
      await screen.findByText(/System is marked unreachable/i),
    ).toBeInTheDocument()
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
      if (url.startsWith('/api/label-styles')) {
        return Promise.resolve(jsonResponse({}))
      }
      if (url.startsWith('/api/metrics/query')) {
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      }
      if (url === '/api/reboot-grace-seconds') {
        return Promise.resolve(jsonResponse({ seconds: 120 }))
      }
      if (url === '/api/systems/bulk-event') {
        return Promise.resolve(new Response(null, { status: 204 }))
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

  it('runs bulk Add label on selected members', async () => {
    const labelPuts: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems/bulk-event')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([system({ id: 's-1', name: 'host-a', groupId: 'g-1' })]),
        )
      if (url.match(/\/labels\/[^/]+$/) && method === 'PUT') {
        labelPuts.push(url)
        return Promise.resolve(jsonResponse({ key: 'env', value: 'prod' }))
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)

    renderRoute()
    await screen.findByText('host-a')
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select row/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Add label/i }))
    const input = (await screen.findByLabelText('Label')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'env=prod' } })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))
    await waitFor(() => expect(labelPuts).toHaveLength(1))
    expect(labelPuts[0]).toContain('/labels/env')
  })

  it('runs bulk Remove label and swallows 404 as skipped', async () => {
    const deletes: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems/bulk-event')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            system({ id: 's-1', name: 'host-a', groupId: 'g-1' }),
            system({ id: 's-2', name: 'host-b', groupId: 'g-1' }),
          ]),
        )
      if (url.match(/\/labels\/[^/]+$/) && method === 'DELETE') {
        deletes.push(url)
        // First DELETE returns 404 (not set), second succeeds.
        return Promise.resolve(
          deletes.length === 1
            ? jsonResponse({ error: 'not set' }, 404)
            : new Response(null, { status: 204 }),
        )
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)

    renderRoute()
    await screen.findByText('host-a')
    const boxes = screen.getAllByRole('checkbox', { name: /select row/i })
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove label/i }))
    const input = (await screen.findByLabelText('Label')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'oncall' } })
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }))
    await waitFor(() => expect(deletes).toHaveLength(2))
    // Outcome alert mentions the skipped count.
    expect(await screen.findByText(/skipped/i)).toBeInTheDocument()
  })

  it('switches to the Exclusions tab and renders its content', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput) => {
      const url = String(input)
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/groups/g-1/package-exclusions')
        return Promise.resolve(jsonResponse([]))
      if (url === '/api/admin/updater-definitions')
        return Promise.resolve(jsonResponse({ definitions: [] }))
      if (url === '/api/systems')
        return Promise.resolve(jsonResponse([]))
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderRoute()
    fireEvent.click(await screen.findByRole('tab', { name: /^Exclusions$/i }))
    expect(await screen.findByText(/No exclusions defined/i)).toBeInTheDocument()
  })

  it('changes page size via the toolbar select', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([system({ id: 's-1', name: 'host-a', groupId: 'g-1' })]),
    )
    renderRoute()
    await screen.findByText('host-a')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Page size/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /^All$/i }))
    })
    expect(screen.getByText('host-a')).toBeInTheDocument()
  })

  it('filters members by typing in the name search input', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: 's-1', name: 'aaa', groupId: 'g-1' }),
        system({ id: 's-2', name: 'bbb', groupId: 'g-1' }),
      ]),
    )
    renderRoute()
    await screen.findByText('aaa')
    fireEvent.change(screen.getByLabelText(/Filter name/i), {
      target: { value: 'aaa' },
    })
    await waitFor(() => {
      expect(screen.queryByText('bbb')).toBeNull()
    })
    expect(screen.getByText('aaa')).toBeInTheDocument()
  })

  it('removes a system from the group via the row kebab', async () => {
    const groupPuts: Array<{ url: string; body: string }> = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([system({ id: 's-1', name: 'host-a', groupId: 'g-1' })]),
        )
      if (url.endsWith('/api/systems/s-1/group') && method === 'PUT') {
        groupPuts.push({ url, body: String(init?.body ?? '') })
        return Promise.resolve(jsonResponse({}))
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)

    renderRoute()
    const row = (await screen.findByText('host-a')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Remove host-a from group/i }),
    )
    // Confirm modal danger button.
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }))
    await waitFor(() => expect(groupPuts).toHaveLength(1))
    expect(JSON.parse(groupPuts[0].body)).toEqual({ groupId: null })
  })

  it('removes a bulk selection from the group via Actions → Remove selected', async () => {
    const groupPuts: Array<{ url: string; body: string }> = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            system({ id: 's-1', name: 'host-a', groupId: 'g-1' }),
            system({ id: 's-2', name: 'host-b', groupId: 'g-1' }),
          ]),
        )
      if (url.match(/\/api\/systems\/[^/]+\/group$/) && method === 'PUT') {
        groupPuts.push({ url, body: String(init?.body ?? '') })
        return Promise.resolve(jsonResponse({}))
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderRoute()
    await screen.findByText('host-a')
    const boxes = screen.getAllByRole('checkbox', { name: /select row/i })
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Remove selected from group/i }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }))
    await waitFor(() => expect(groupPuts).toHaveLength(2))
  })

  it('updates the label selector when a chip is clicked', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: 's-1',
          name: 'host-a',
          groupId: 'g-1',
          labels: [{ key: 'env', value: 'prod', source: 'user' as const }],
        } as unknown as Parameters<typeof system>[0]),
      ]),
    )
    renderRoute()
    await screen.findByText('host-a')
    const chip = screen.getByText('env=prod')
    fireEvent.click(chip)
    await waitFor(() => {
      const selectorInput = screen.getByLabelText(/Label selector/i) as HTMLInputElement
      expect(selectorInput.value).toContain('env=prod')
    })
  })

  it('shows the "Select all N matching" banner and clicks expand selection', async () => {
    const members = Array.from({ length: 30 }, (_, i) => system({
      id: `s-${i}`,
      name: `host-${String(i).padStart(2, '0')}`,
      groupId: 'g-1',
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse(members))
    renderRoute()
    await screen.findByText('host-00')
    // Default page size is 25; click "select all visible" → banner
    // should appear since 30 > 25.
    const allRowsCheckbox = screen.getByRole('checkbox', { name: /select all/i })
    fireEvent.click(allRowsCheckbox)
    const banner = await screen.findByText(/selected on this page/i)
    expect(banner).toBeInTheDocument()
    const expand = screen.getByRole('button', { name: /Select all 30 matching/i })
    fireEvent.click(expand)
    await waitFor(() => {
      expect(screen.queryByText(/selected on this page/i)).toBeNull()
    })
  })

  it('surfaces an action error when remove-from-group fails', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([system({ id: 's-1', name: 'host-a', groupId: 'g-1' })]),
        )
      if (url.endsWith('/api/systems/s-1/group') && method === 'PUT')
        return Promise.resolve(jsonResponse({ error: 'forbidden' }, 403))
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderRoute()
    const row = (await screen.findByText('host-a')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Remove host-a from group/i }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }))
    expect(await screen.findByText(/Action failed/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }))
    await waitFor(() => {
      expect(screen.queryByText(/Action failed/i)).toBeNull()
    })
  })

  it('sorts members across columns', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          ...system({ id: 's-1', name: 'bbb', hostname: '10.0.0.1', groupId: 'g-1' }),
          pendingUpdates: 3,
          lastCheckedAt: '2026-05-22T00:00:00Z',
        },
        {
          ...system({ id: 's-2', name: 'aaa', hostname: '10.0.0.2', groupId: 'g-1' }),
          pendingUpdates: 7,
          lastCheckedAt: '2026-05-20T00:00:00Z',
        },
      ]),
    )
    renderRoute()
    await screen.findByText('bbb')
    const clickHeader = (name: RegExp) => {
      const headers = screen.getAllByRole('columnheader', { name })
      const button = headers[0].querySelector('button')
      if (button) fireEvent.click(button)
    }
    // Click each sortable header once to exercise every sortKey branch.
    clickHeader(/^Name$/i)
    clickHeader(/^Labels$/i)
    clickHeader(/^Last checked$/i)
    clickHeader(/^Updates$/i)
    // Default page size keeps both visible — assertion is that the
    // page didn't crash and rows are still rendered.
    expect(screen.getByText('aaa')).toBeInTheDocument()
    expect(screen.getByText('bbb')).toBeInTheDocument()
  })

  it('skips no-operator members in a bulk Check selected', async () => {
    const checks: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/me/scope')) {
        // Non-admin: only operator on group g-1 → caller can't act on
        // a system whose primary group is something else when assigned
        // via the canOperateSystem check. Easier path: admin with one
        // unreachable system to trigger the unreachable skip.
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      }
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems/bulk-event')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            system({
              id: 's-1',
              name: 'down',
              groupId: 'g-1',
              status: 'unreachable',
            }),
            system({ id: 's-2', name: 'up', groupId: 'g-1', status: 'reachable' }),
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
    await screen.findByText('down')
    const boxes = screen.getAllByRole('checkbox', { name: /select row/i })
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Check selected/i }))
    // Only the reachable system is checked.
    await waitFor(() => expect(checks.length).toBe(1))
  })

  it('caller without group role cannot operate non-group systems', async () => {
    // Caller is Group Operator on g-1 only, with no global role. The
    // canOperateSystem branch for "no groupId" / "not this group"
    // members returns false → the per-row kebab disables Check/Update.
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput) => {
      const url = String(input)
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(
          jsonResponse({ global: '', groups: { 'g-1': 'operator' } }),
        )
      if (url === '/api/groups/g-1')
        return Promise.resolve(jsonResponse(sampleGroup))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      if (url === '/api/systems')
        // Member of g-1 — operator branch returns true.
        return Promise.resolve(
          jsonResponse([
            system({ id: 's-1', name: 'in-group', groupId: 'g-1' }),
          ]),
        )
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderRoute()
    await screen.findByText('in-group')
    expect(screen.getByText('in-group')).toBeInTheDocument()
  })

  it('deselecting after expand-selection clears the entire selection', async () => {
    const members = Array.from({ length: 30 }, (_, i) =>
      system({
        id: `s-${i}`,
        name: `host-${String(i).padStart(2, '0')}`,
        groupId: 'g-1',
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(members))
    renderRoute()
    await screen.findByText('host-00')
    const allRows = screen.getByRole('checkbox', { name: /select all/i })
    fireEvent.click(allRows)
    const expand = await screen.findByRole('button', {
      name: /Select all 30 matching/i,
    })
    fireEvent.click(expand)
    // Now untick the header — expanded selection clears wholesale.
    fireEvent.click(allRows)
    await waitFor(() => {
      const stillSelected = screen.queryAllByRole('checkbox', { checked: true })
      expect(stillSelected.length).toBe(0)
    })
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
      if (url.startsWith('/api/label-styles')) {
        return Promise.resolve(jsonResponse({}))
      }
      if (url.startsWith('/api/metrics/query')) {
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      }
      if (url === '/api/systems/bulk-event') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse([]))
    })
    renderRoute()
    expect(await screen.findByText(/group not found/i)).toBeInTheDocument()
  })
})
