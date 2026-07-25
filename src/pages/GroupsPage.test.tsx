// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupsPage from './GroupsPage'

function renderWithRouter(initialPath = '/groups') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <GroupsPage />
    </MemoryRouter>,
  )
}

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function group(overrides: Partial<{ id: string; name: string; systemCount: number }> = {}) {
  return {
    id: 'g-1',
    name: 'prod',
    createdAt: '2026-01-01T00:00:00Z',
    systemCount: 0,
    ...overrides,
  }
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

describe('GroupsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    // GroupsPage now loads scope + systems alongside groups so the
    // per-row Check/Update actions can fan out across each group's
    // members. The default wrapped fetch short-circuits both with
    // empty results so the existing mockResolvedValueOnce queues
    // for /api/groups stay aligned.
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ groups: {} }))
      if (url === '/api/systems' && (init?.method ?? 'GET') === 'GET')
        return Promise.resolve(jsonResponse([]))
      return (fetchMock as unknown as typeof fetch)(input, init)
    }
    vi.stubGlobal('fetch', wrapped)
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the empty state when no groups exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    renderWithRouter()
    expect(await screen.findByText(/no system groups yet/i)).toBeInTheDocument()
  })

  it('renders rows with system count and links the name to the detail route', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([group({ id: 'g-1', name: 'prod', systemCount: 3 })]),
    )
    renderWithRouter()
    const row = (await screen.findByText('prod')).closest('tr')!
    expect(within(row).getByText('3')).toBeInTheDocument()
    const link = within(row).getByRole('link', { name: 'prod' })
    expect(link.getAttribute('href')).toBe('/groups/g-1')
  })

  it('creates a group via the Add modal', async () => {
    const created = group({ id: 'g-1', name: 'staging' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse([])) // initial list
      .mockResolvedValueOnce(jsonResponse(created, 201)) // create
      .mockResolvedValueOnce(jsonResponse([created])) // refetch
    renderWithRouter()
    await screen.findByText(/no system groups yet/i)
    fireEvent.click(screen.getByRole('button', { name: /^actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /add system group/i }))
    const nameInput = (await screen.findByRole('dialog')).querySelector(
      '#add-group-name',
    ) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'staging' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => {
      expect(screen.getByText('staging')).toBeInTheDocument()
    })
    const calls = fetchMock.mock.calls.map((c) => [
      c[0],
      (c[1] as RequestInit | undefined)?.method ?? 'GET',
    ])
    expect(calls).toContainEqual(['/api/groups', 'POST'])
  })

  it('row kebab Check on a group fans out across its member systems', async () => {
    const checks: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(
          jsonResponse([group({ id: 'g-1', name: 'prod', systemCount: 2 })]),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            { id: 's-a', name: 'a', hostname: '10.0.0.1', createdAt: '2026-01-01T00:00:00Z', status: 'reachable', groupId: 'g-1' },
            { id: 's-b', name: 'b', hostname: '10.0.0.2', createdAt: '2026-01-01T00:00:00Z', status: 'reachable', groupId: 'g-1' },
            { id: 's-c', name: 'c', hostname: '10.0.0.3', createdAt: '2026-01-01T00:00:00Z', status: 'reachable', groupId: 'other' },
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

    renderWithRouter()
    const row = (await screen.findByText('prod')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Check$/i }))
    // Two member systems → two fan-outs; the third belongs to a
    // different group and must not be touched.
    await waitFor(() => expect(checks).toHaveLength(2))
    expect(checks.some((u) => u.includes('/systems/s-a/'))).toBe(true)
    expect(checks.some((u) => u.includes('/systems/s-b/'))).toBe(true)
    expect(checks.every((u) => !u.includes('/systems/s-c/'))).toBe(true)
  })

  it('bulk Update selected groups asks for confirmation before firing apply', async () => {
    const applies: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(
          jsonResponse([group({ id: 'g-1', name: 'prod', systemCount: 1 })]),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            { id: 's-a', name: 'a', hostname: '10.0.0.1', createdAt: '2026-01-01T00:00:00Z', status: 'reachable', groupId: 'g-1' },
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
            affectedCount: 2,
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

    renderWithRouter()
    await screen.findByText('prod')
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select row/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Update selected groups/i }),
    )
    expect(applies).toHaveLength(0)
    expect(
      await screen.findByText(/Update systems in 1 group\?/i),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Update$/i }))
    await waitFor(() => expect(applies).toHaveLength(1))
  })

  it('surfaces an error when load fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500))
    renderWithRouter()
    expect(
      await screen.findByText(/could not load system groups/i),
    ).toBeInTheDocument()
  })

  it('shows an inline spinner next to a group name when one of its members is running an updater', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            group({ id: 'g-1', name: 'prod', systemCount: 2 }),
            group({ id: 'g-2', name: 'staging', systemCount: 1 }),
          ]),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            // Two members in prod, one running.
            {
              id: 's-a',
              name: 'a',
              hostname: '10.0.0.1',
              createdAt: '2026-01-01T00:00:00Z',
              status: 'reachable',
              groupId: 'g-1',
              running: true,
            },
            {
              id: 's-b',
              name: 'b',
              hostname: '10.0.0.2',
              createdAt: '2026-01-01T00:00:00Z',
              status: 'reachable',
              groupId: 'g-1',
            },
            // Staging member idle.
            {
              id: 's-c',
              name: 'c',
              hostname: '10.0.0.3',
              createdAt: '2026-01-01T00:00:00Z',
              status: 'reachable',
              groupId: 'g-2',
            },
          ]),
        )
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)

    renderWithRouter()
    const prodRow = (await screen.findByText('prod')).closest('tr')!
    const stagingRow = screen.getByText('staging').closest('tr')!
    // prod has a running member → spinner present with descriptive aria-label.
    expect(
      within(prodRow).getByLabelText(/1 system in this group running an updater/i),
    ).toBeInTheDocument()
    // staging has nothing in flight → no spinner.
    expect(
      within(stagingRow).queryByLabelText(/running an updater/i),
    ).toBeNull()
  })

  it('bulk Check on a no-member group reports a skipped outcome', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(
          jsonResponse([group({ id: 'g-1', name: 'empty', systemCount: 0 })]),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(jsonResponse([]))
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderWithRouter()
    await screen.findByText('empty')
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select row/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Check selected groups/i }),
    )
    expect(
      await screen.findByText(/No systems in the selected group/i),
    ).toBeInTheDocument()
  })

  it('bulk Remove selected groups runs DELETE on confirm', async () => {
    const deletes: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            group({ id: 'g-1', name: 'a' }),
            group({ id: 'g-2', name: 'b' }),
          ]),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(jsonResponse([]))
      if (url.match(/^\/api\/groups\/g-\d+$/) && method === 'DELETE') {
        deletes.push(url)
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderWithRouter()
    await screen.findByText('a')
    const boxes = screen.getAllByRole('checkbox', { name: /select row/i })
    fireEvent.click(boxes[0])
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: /^Remove selected/i }),
    )
    // Confirm modal danger button.
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }))
    await waitFor(() => expect(deletes).toHaveLength(2))
  })

  it('surfaces a delete error from removeOne and clears via Dismiss', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(jsonResponse([group({ id: 'g-1', name: 'doomed' })]))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(jsonResponse([]))
      if (url === '/api/groups/g-1' && method === 'DELETE')
        return Promise.resolve(jsonResponse({ error: 'in use' }, 409))
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderWithRouter()
    const row = (await screen.findByText('doomed')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Remove doomed/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }))
    expect(await screen.findByText(/in use/i)).toBeInTheDocument()
  })

  it('renames a group via the rename modal', async () => {
    const puts: Array<{ url: string; body: string }> = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(jsonResponse([group({ id: 'g-1', name: 'old' })]))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(jsonResponse([]))
      if (url === '/api/groups/g-1' && method === 'PATCH') {
        puts.push({ url, body: String(init?.body ?? '') })
        return Promise.resolve(
          jsonResponse({ ...group({ id: 'g-1', name: 'new' }) }),
        )
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('EventSource', FakeEventSource)
    renderWithRouter()
    const row = (await screen.findByText('old')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename old/i }))
    const dialog = await screen.findByRole('dialog')
    const input = dialog.querySelector('#rename-group-name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'new' } })
    // jsdom's button[type="submit" form="..."] doesn't always trigger
    // the form submit handler — fire submit directly on the form.
    const form = dialog.querySelector('#rename-group-form') as HTMLFormElement
    fireEvent.submit(form)
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(JSON.parse(puts[0].body)).toEqual({ name: 'new' })
  })

  it('filters groups by typing in the name search input', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        group({ id: 'g-1', name: 'alpha' }),
        group({ id: 'g-2', name: 'beta' }),
      ]),
    )
    renderWithRouter()
    await screen.findByText('alpha')
    fireEvent.change(screen.getByLabelText(/Filter name/i), {
      target: { value: 'beta' },
    })
    await waitFor(() => {
      expect(screen.queryByText('alpha')).toBeNull()
    })
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  it('toggleAllVisible selects every visible row when header is ticked', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        group({ id: 'g-1', name: 'a' }),
        group({ id: 'g-2', name: 'b' }),
      ]),
    )
    renderWithRouter()
    await screen.findByText('a')
    const allRows = screen.getByRole('checkbox', { name: /select all/i })
    fireEvent.click(allRows)
    const rowBoxes = screen.getAllByRole('checkbox', { name: /select row/i })
    rowBoxes.forEach((b) => expect((b as HTMLInputElement).checked).toBe(true))
    // Untick deselects.
    fireEvent.click(allRows)
    rowBoxes.forEach((b) => expect((b as HTMLInputElement).checked).toBe(false))
  })

  it('row kebab Check skips unreachable members and reports them in the outcomes panel', async () => {
    const checks: string[] = []
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/groups' && method === 'GET')
        return Promise.resolve(
          jsonResponse([group({ id: 'g-1', name: 'prod', systemCount: 2 })]),
        )
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            {
              id: 's-a',
              name: 'web-1',
              hostname: '10.0.0.1',
              createdAt: '2026-01-01T00:00:00Z',
              status: 'reachable',
              groupId: 'g-1',
            },
            {
              id: 's-b',
              name: 'web-2-down',
              hostname: '10.0.0.2',
              createdAt: '2026-01-01T00:00:00Z',
              status: 'unreachable',
              groupId: 'g-1',
            },
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

    renderWithRouter()
    const row = (await screen.findByText('prod')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Check$/i }))
    // Only the reachable member fires; the unreachable one is skipped.
    await waitFor(() => expect(checks).toHaveLength(1))
    expect(checks[0]).toContain('/systems/s-a/')
    expect(
      await screen.findByText(/System is marked unreachable\./i),
    ).toBeInTheDocument()
  })
})
