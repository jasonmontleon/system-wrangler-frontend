// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import SystemsPage from './SystemsPage'

// render wraps every SystemsPage mount in a MemoryRouter so the
// per-row <Link to="/systems/:id"> resolves a routing context. The
// router is otherwise inert — tests don't navigate.
function render(ui: ReactElement) {
  return rtlRender(<MemoryRouter>{ui}</MemoryRouter>)
}

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function system(
  overrides: Partial<{
    id: string
    name: string
    hostname: string
    status: string
    lastSeen: string
    lastCheckedAt: string
    pendingUpdates: number
    pendingPackages: string[]
    lastRunFailed: boolean
    lastRunReason: string
  }> = {},
) {
  return {
    id: '1',
    name: 'sys-1',
    hostname: '10.0.0.1',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'unprobed' as const,
    ...overrides,
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== fn)
  }
  close() {}
  emit(type: string, data: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data) })
    ;(this.listeners[type] ?? []).forEach((fn) => fn(e))
  }
}

function clickActionsItem(label: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^actions$/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}

function clickRowKebab(row: HTMLElement, label: RegExp) {
  fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}

describe('SystemsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    // The Group column reads /api/groups on mount; short-circuit it to an
    // empty list so the mockResolvedValueOnce queue for /api/systems is
    // not consumed by the unrelated groups request.
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      // useScope mounts inside SystemsPage for the operate-action
      // gating. Short-circuit it to an empty scope so the existing
      // mockResolvedValueOnce queues stay aligned. Individual tests
      // that care about scope can override by stubbing fetch
      // directly.
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ groups: {} }))
      return (fetchMock as unknown as typeof fetch)(input, init)
    }
    vi.stubGlobal('fetch', wrapped)
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the empty state when there are no systems', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<SystemsPage />)
    expect(await screen.findByText(/no systems yet/i)).toBeInTheDocument()
  })

  it('renders status, last-checked, and updates-available columns', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: '1',
          name: 'up',
          hostname: '10.0.0.1',
          status: 'reachable',
          lastSeen: '2026-05-05T12:00:00Z',
          lastCheckedAt: '2026-05-16T09:00:00Z',
          pendingUpdates: 3,
        }),
        system({ id: '2', name: 'down', hostname: '10.0.0.2', status: 'unreachable' }),
        system({ id: '3', name: 'fresh', hostname: '10.0.0.3', status: 'unprobed' }),
      ]),
    )
    render(<SystemsPage />)
    const upRow = (await screen.findByText('up')).closest('tr')!
    expect(within(upRow).getByText('Reachable')).toBeInTheDocument()
    const downRow = screen.getByText('down').closest('tr')!
    expect(within(downRow).getByText('Unreachable')).toBeInTheDocument()
    const freshRow = screen.getByText('fresh').closest('tr')!
    expect(within(freshRow).getByText('Unprobed')).toBeInTheDocument()
    const lastChecked = (row: HTMLElement) =>
      row.querySelector('td[data-label="Last checked"]') as HTMLElement
    const updates = (row: HTMLElement) =>
      row.querySelector('td[data-label="Updates available"]') as HTMLElement
    // Never-checked systems show "Never" + "—".
    expect(lastChecked(downRow)).toHaveTextContent('Never')
    expect(updates(downRow)).toHaveTextContent('—')
    // Checked system shows a formatted date + the integer count.
    expect(lastChecked(upRow).textContent).not.toMatch(/^Never$/)
    expect(updates(upRow)).toHaveTextContent('3')
  })

  it('opens Add system from the Actions menu, defaults Name from Hostname, and submits', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(system({ id: '1', name: 'srv.example.com', hostname: 'srv.example.com' }), 201),
      )
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '1', name: 'srv.example.com', hostname: 'srv.example.com' })]),
      )

    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())

    clickActionsItem(/add system/i)
    const modal = await screen.findByRole('dialog')
    const hostnameInput = within(modal).getByLabelText(/hostname/i) as HTMLInputElement
    const nameInput = within(modal).getByLabelText(/^name/i) as HTMLInputElement

    fireEvent.change(hostnameInput, { target: { value: 'srv.example.com' } })
    expect(nameInput.value).toBe('srv.example.com')

    fireEvent.click(within(modal).getByRole('button', { name: /^add$/i }))

    const matches = await screen.findAllByText('srv.example.com')
    expect(matches.length).toBeGreaterThanOrEqual(1)

    const postCall = fetchMock.mock.calls[1] as [string, FetchInit]
    expect(postCall[0]).toBe('/api/systems')
    expect(postCall[1]?.method).toBe('POST')
    expect(JSON.parse(postCall[1]?.body as string)).toEqual({
      name: 'srv.example.com',
      hostname: 'srv.example.com',
    })
  })

  it('lets the user override the auto-defaulted Name', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(system({ id: '1', name: 'web prod', hostname: '10.0.0.5' }), 201),
      )
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '1', name: 'web prod', hostname: '10.0.0.5' })]),
      )

    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())

    clickActionsItem(/add system/i)
    const modal = await screen.findByRole('dialog')
    const hostnameInput = within(modal).getByLabelText(/hostname/i)
    const nameInput = within(modal).getByLabelText(/^name/i) as HTMLInputElement

    fireEvent.change(hostnameInput, { target: { value: '10.0.0.5' } })
    expect(nameInput.value).toBe('10.0.0.5')
    fireEvent.change(nameInput, { target: { value: 'web prod' } })
    fireEvent.change(hostnameInput, { target: { value: '10.0.0.6' } })
    expect(nameInput.value).toBe('web prod')

    fireEvent.change(hostnameInput, { target: { value: '10.0.0.5' } })
    fireEvent.click(within(modal).getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText('web prod')).toBeInTheDocument()
  })

  it('shows server validation errors and keeps the modal open', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ error: 'hostname is required' }, 400))

    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())

    clickActionsItem(/add system/i)
    const modal = await screen.findByRole('dialog')
    fireEvent.change(within(modal).getByLabelText(/hostname/i), { target: { value: 'x' } })
    fireEvent.change(within(modal).getByLabelText(/^name/i), { target: { value: 'x' } })
    fireEvent.click(within(modal).getByRole('button', { name: /^add$/i }))

    expect(await within(modal).findByText(/hostname is required/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeInTheDocument()
  })

  it('removes a system only after confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '1', name: 'doomed', hostname: '1.1.1.1' })]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))

    render(<SystemsPage />)
    const row = (await screen.findByText('doomed')).closest('tr')!
    clickRowKebab(row, /remove doomed/i)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/permanently remove doomed/i)).toBeInTheDocument()
    expect(
      (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).filter(
        (c) => c[1]?.method === 'DELETE',
      ),
    ).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }))

    await waitFor(() =>
      expect(screen.getByText(/no systems yet/i)).toBeInTheDocument(),
    )

    const deleteCall = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
      (c) => c[1]?.method === 'DELETE',
    )
    expect(deleteCall![0]).toBe('/api/systems/1')
  })

  it('bulk-removes selected systems via the Actions menu', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          system({ id: '1', name: 'a', hostname: '10.0.0.1' }),
          system({ id: '2', name: 'b', hostname: '10.0.0.2' }),
          system({ id: '3', name: 'c', hostname: '10.0.0.3' }),
        ]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '3', name: 'c', hostname: '10.0.0.3' })]),
      )

    render(<SystemsPage />)
    await screen.findByText('a')

    fireEvent.click(within(screen.getByText('a').closest('tr')!).getByRole('checkbox'))
    fireEvent.click(within(screen.getByText('b').closest('tr')!).getByRole('checkbox'))

    clickActionsItem(/remove selected/i)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }))

    await waitFor(() => {
      expect(screen.queryByText('a')).not.toBeInTheDocument()
      expect(screen.queryByText('b')).not.toBeInTheDocument()
    })
    const deleteCalls = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).filter(
      (c) => c[1]?.method === 'DELETE',
    )
    expect(deleteCalls.map((c) => c[0]).sort()).toEqual(['/api/systems/1', '/api/systems/2'])
  })

  it('filters by hostname via the column filter input', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: '1', name: 'a', hostname: 'alpha.example.com' }),
        system({ id: '2', name: 'b', hostname: 'beta.example.com' }),
        system({ id: '3', name: 'c', hostname: 'gamma.example.com' }),
      ]),
    )
    render(<SystemsPage />)
    await screen.findByText('alpha.example.com')

    const filter = screen.getByLabelText(/filter hostname/i)
    fireEvent.change(filter, { target: { value: 'beta' } })

    expect(screen.getByText('beta.example.com')).toBeInTheDocument()
    expect(screen.queryByText('alpha.example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('gamma.example.com')).not.toBeInTheDocument()
  })

  it('sorts by name when the column header is clicked', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: '1', name: 'charlie', hostname: '10.0.0.1' }),
        system({ id: '2', name: 'alpha', hostname: '10.0.0.2' }),
        system({ id: '3', name: 'bravo', hostname: '10.0.0.3' }),
      ]),
    )
    render(<SystemsPage />)
    await screen.findByText('alpha')

    const rows0 = screen.getAllByRole('row').slice(2).map((r) => r.textContent)
    // Initial sort key is name asc → already sorted.
    expect(rows0[0]).toContain('alpha')
    expect(rows0[1]).toContain('bravo')
    expect(rows0[2]).toContain('charlie')

    const header = screen.getByRole('columnheader', { name: /^name/i })
    fireEvent.click(header.querySelector('button')!)
    const rows1 = screen.getAllByRole('row').slice(2).map((r) => r.textContent)
    expect(rows1[0]).toContain('charlie')
    expect(rows1[1]).toContain('bravo')
    expect(rows1[2]).toContain('alpha')
  })

  it('paginates and offers an All option', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      system({ id: `s${i}`, name: `sys${i.toString().padStart(2, '0')}`, hostname: `10.0.0.${i}` }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(many))
    render(<SystemsPage />)
    await screen.findByText('sys00')

    expect(screen.queryByText('sys29')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /page size/i }))
    fireEvent.click(await screen.findByRole('option', { name: /^all$/i }))
    expect(await screen.findByText('sys29')).toBeInTheDocument()
  })

  it('refetches when a systems.changed event arrives', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '99', name: 'late-arrival', hostname: '10.0.0.99' })]),
      )

    render(<SystemsPage />)
    expect(await screen.findByText(/no systems yet/i)).toBeInTheDocument()

    FakeEventSource.instances[0].emit('message', { type: 'systems.changed' })
    expect(await screen.findByText('late-arrival')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/systems')).toHaveLength(2)
  })

  it('debounces bursts of events into a single refetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())

    const initialCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length

    const es = FakeEventSource.instances[0]
    es.emit('message', { type: 'systems.changed' })
    es.emit('message', { type: 'systems.changed' })
    es.emit('message', { type: 'systems.changed' })

    await new Promise((r) => setTimeout(r, 300))

    const newCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length
    expect(newCalls - initialCalls).toBe(1)
  })

  it('ignores events of unknown types', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())
    const initialCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length

    FakeEventSource.instances[0].emit('message', { type: 'something.else' })
    await new Promise((r) => setTimeout(r, 300))

    const newCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length
    expect(newCalls - initialCalls).toBe(0)
  })

  it('shows a load error when the list request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<SystemsPage />)
    expect(await screen.findByText(/could not load systems/i)).toBeInTheDocument()
  })

  it('hides Check/Update from a caller without operator role', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([system({ id: '1', name: 'host-x', hostname: 'x.example' })]),
    )
    render(<SystemsPage />)
    const row = (await screen.findByText('host-x')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    expect(screen.queryByRole('menuitem', { name: /^Check$/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /^Update$/i })).toBeNull()
  })

  it('fan-out Check from the kebab fires per enabled updater and banners the result', async () => {
    vi.unstubAllGlobals()
    let listSystemsCalls = 0
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET') {
        listSystemsCalls++
        return Promise.resolve(
          jsonResponse([system({ id: '1', name: 'host-x', hostname: 'x.example' })]),
        )
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
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
      }
      if (url.endsWith('/check') && method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            runId: 'r-1',
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
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    const row = (await screen.findByText('host-x')).closest('tr')!
    clickRowKebab(row, /^Check$/i)
    // Phase 5 results card: aggregate "Ran check on 1 system" header
    // plus a per-system row linking to /systems/host-x with the
    // "1/1 updater(s) ok" summary.
    expect(
      await screen.findByText(/Ran check on 1 system/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/1\/1 updater\(s\) ok/i)).toBeInTheDocument()
    expect(listSystemsCalls).toBeGreaterThan(0)
  })

  it('shows an in-flight spinner on the row and a toolbar pill while a Check is running', async () => {
    vi.unstubAllGlobals()
    // Hold the /check response so we can observe the busy state.
    let resolveCheck: (r: Response) => void = () => {}
    const checkPending = new Promise<Response>((res) => {
      resolveCheck = res
    })
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([system({ id: '1', name: 'host-x' })]),
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
      if (url.endsWith('/check') && method === 'POST') return checkPending
      return Promise.resolve(jsonResponse({}, 500))
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    const row = (await screen.findByText('host-x')).closest('tr')!
    clickRowKebab(row, /^Check$/i)

    // While the /check request is in flight, the row should swap its
    // status icon for a spinner and the toolbar should show a pill
    // labelling the in-flight count.
    expect(
      await within(row).findByLabelText(/Check in progress/i),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/In-flight tasks/i).textContent,
    ).toMatch(/1 task running/i)

    // Let the /check resolve; both spinner and pill should clear.
    resolveCheck(
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
    await waitFor(() =>
      expect(within(row).queryByLabelText(/Check in progress/i)).toBeNull(),
    )
    expect(screen.queryByLabelText(/In-flight tasks/i)).toBeNull()
  })

  it('renders the fan-out results as a fixed-position overlay that does not shift layout', async () => {
    vi.unstubAllGlobals()
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([system({ id: '1', name: 'host-x', hostname: 'x.example' })]),
        )
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
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
      }
      if (url.endsWith('/check') && method === 'POST') {
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
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    const row = (await screen.findByText('host-x')).closest('tr')!
    clickRowKebab(row, /^Check$/i)
    const card = await screen.findByLabelText(/Updater action results/i)
    // The wrapper that the card lives in must use fixed positioning
    // — that's what stops the table beneath from shifting on
    // appear / dismiss. The wrapper is the card's parentElement.
    const wrapper = card.parentElement as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.style.position).toBe('fixed')
  })

  it('auto-dismisses the results panel after the idle timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.unstubAllGlobals()
      const wrapped = (input: FetchInput, init?: FetchInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        if (url === '/api/me/scope')
          return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
        if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
        if (url === '/api/systems' && method === 'GET') {
          return Promise.resolve(
            jsonResponse([system({ id: '1', name: 'host-x', hostname: 'x.example' })]),
          )
        }
        if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
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
        }
        if (url.endsWith('/check') && method === 'POST') {
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
      }
      vi.stubGlobal('fetch', wrapped)
      vi.stubGlobal('EventSource', FakeEventSource)

      render(<SystemsPage />)
      const row = (await screen.findByText('host-x')).closest('tr')!
      clickRowKebab(row, /^Check$/i)
      const card = await screen.findByLabelText(/Updater action results/i)
      expect(card).toBeInTheDocument()
      // Advance past the 8s auto-dismiss window.
      await vi.advanceTimersByTimeAsync(8100)
      await waitFor(() =>
        expect(screen.queryByLabelText(/Updater action results/i)).toBeNull(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not auto-dismiss the results panel while the operator hovers it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.unstubAllGlobals()
      const wrapped = (input: FetchInput, init?: FetchInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = init?.method ?? 'GET'
        if (url === '/api/me/scope')
          return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
        if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
        if (url === '/api/systems' && method === 'GET') {
          return Promise.resolve(
            jsonResponse([system({ id: '1', name: 'host-x', hostname: 'x.example' })]),
          )
        }
        if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
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
        }
        if (url.endsWith('/check') && method === 'POST') {
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
      }
      vi.stubGlobal('fetch', wrapped)
      vi.stubGlobal('EventSource', FakeEventSource)

      render(<SystemsPage />)
      const row = (await screen.findByText('host-x')).closest('tr')!
      clickRowKebab(row, /^Check$/i)
      const card = await screen.findByLabelText(/Updater action results/i)
      const wrapper = card.parentElement as HTMLElement
      fireEvent.mouseEnter(wrapper)
      await vi.advanceTimersByTimeAsync(8100)
      // Still present despite the idle window having passed.
      expect(
        screen.getByLabelText(/Updater action results/i),
      ).toBeInTheDocument()
      // Leaving restarts the window; advancing through it clears the panel.
      fireEvent.mouseLeave(wrapper)
      await vi.advanceTimersByTimeAsync(8100)
      await waitFor(() =>
        expect(screen.queryByLabelText(/Updater action results/i)).toBeNull(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('bulk Check selected fans out across selected systems in parallel', async () => {
    vi.unstubAllGlobals()
    const checkCalls: string[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([
            system({ id: 'a', name: 'host-a', hostname: 'a.example' }),
            system({ id: 'b', name: 'host-b', hostname: 'b.example' }),
          ]),
        )
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
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
      }
      if (url.endsWith('/check') && method === 'POST') {
        checkCalls.push(url)
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
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    await screen.findByText('host-a')
    // Select both rows via the per-row checkboxes.
    const checkboxes = screen.getAllByRole('checkbox', { name: /select row/i })
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    // Open the Actions dropdown and trigger Check selected.
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Check selected/i }))
    await waitFor(() => expect(checkCalls).toHaveLength(2))
    expect(checkCalls.some((u) => u.includes('/systems/a/'))).toBe(true)
    expect(checkCalls.some((u) => u.includes('/systems/b/'))).toBe(true)
    // Both systems show up as their own rows inside the results
    // card (scope by aria-label to avoid colliding with the table's
    // own row links).
    const card = await screen.findByLabelText(/Updater action results/i)
    expect(within(card).getByRole('link', { name: 'host-a' })).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'host-b' })).toBeInTheDocument()
    expect(within(card).getByText(/Ran check on 2 systems/i)).toBeInTheDocument()
  })

  it('bulk Update selected opens a confirm modal and fires apply on confirm', async () => {
    vi.unstubAllGlobals()
    const applyCalls: string[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([
            system({ id: 'a', name: 'host-a', hostname: 'a.example' }),
          ]),
        )
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
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
      }
      if (url.endsWith('/apply') && method === 'POST') {
        applyCalls.push(url)
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
      return Promise.resolve(jsonResponse({}, 500))
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    await screen.findByText('host-a')
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select row/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Update selected/i }))
    // Confirm modal — no POST should have fired yet.
    expect(applyCalls).toHaveLength(0)
    expect(await screen.findByText(/Update 1 system\?/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Update$/i }))
    await waitFor(() => expect(applyCalls).toHaveLength(1))
    expect(applyCalls[0]).toContain('/systems/a/updaters/builtin.dnf/apply')
  })

  it('bulk Update cancel does not fire any apply', async () => {
    vi.unstubAllGlobals()
    const applyCalls: string[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([
            system({ id: 'a', name: 'host-a', hostname: 'a.example' }),
          ]),
        )
      }
      if (url.endsWith('/apply') && method === 'POST') {
        applyCalls.push(url)
        return Promise.resolve(jsonResponse({}, 500))
      }
      return Promise.resolve(jsonResponse({}, 500))
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    await screen.findByText('host-a')
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select row/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Update selected/i }))
    await screen.findByText(/Update 1 system\?/i)
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
    // Modal closes without firing any apply.
    await waitFor(() =>
      expect(screen.queryByText(/Update 1 system\?/i)).toBeNull(),
    )
    expect(applyCalls).toHaveLength(0)
  })

  it('shows a hover tooltip listing the pending packages when count > 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: '1',
          name: 'busy',
          hostname: '10.0.0.1',
          status: 'reachable',
          lastCheckedAt: '2026-05-16T09:00:00Z',
          pendingUpdates: 2,
          pendingPackages: ['kernel', 'glibc'],
        }),
      ]),
    )
    render(<SystemsPage />)
    const row = (await screen.findByText('busy')).closest('tr')!
    const cell = row.querySelector(
      'td[data-label="Updates available"]',
    ) as HTMLElement
    // The cell renders the count and decorates the trigger with the
    // dotted-underline affordance.
    const trigger = within(cell).getByText('2')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveStyle({ cursor: 'help' })
    // Hovering reveals the package list. PatternFly Tooltip portals
    // its content into the document body and toggles role=tooltip
    // visibility on focus / hover.
    fireEvent.mouseEnter(trigger)
    expect(await screen.findByText('kernel')).toBeInTheDocument()
    expect(screen.getByText('glibc')).toBeInTheDocument()
  })

  it('does not wrap the count in a tooltip when pending = 0', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: '1',
          name: 'idle',
          hostname: '10.0.0.1',
          status: 'reachable',
          lastCheckedAt: '2026-05-16T09:00:00Z',
          pendingUpdates: 0,
          pendingPackages: [],
        }),
      ]),
    )
    render(<SystemsPage />)
    const row = (await screen.findByText('idle')).closest('tr')!
    const cell = row.querySelector(
      'td[data-label="Updates available"]',
    ) as HTMLElement
    const zero = within(cell).getByText('0')
    // No help-cursor / dotted affordance on a non-tooltip cell.
    expect(zero).not.toHaveStyle({ cursor: 'help' })
  })

  it('renders a red X for reachable systems whose last run failed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: '1',
          name: 'sad',
          hostname: '10.0.0.1',
          status: 'reachable',
          lastCheckedAt: '2026-05-16T09:00:00Z',
          pendingUpdates: 0,
          lastRunFailed: true,
          lastRunReason: 'apply exit 2',
        }),
      ]),
    )
    render(<SystemsPage />)
    const row = (await screen.findByText('sad')).closest('tr')!
    // The Up-to-date glyph must not win — the failed-run glyph takes
    // precedence even though pendingUpdates is 0.
    expect(within(row).queryByLabelText(/Up to date/i)).toBeNull()
    expect(within(row).getByLabelText(/Last run failed/i)).toBeInTheDocument()
  })

  it('renders the per-row status icon for reachable, pending, and unreachable systems', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: '1',
          name: 'green',
          hostname: '10.0.0.1',
          status: 'reachable',
          lastCheckedAt: '2026-05-16T09:00:00Z',
          pendingUpdates: 0,
        }),
        system({
          id: '2',
          name: 'yellow',
          hostname: '10.0.0.2',
          status: 'reachable',
          lastCheckedAt: '2026-05-16T09:00:00Z',
          pendingUpdates: 7,
        }),
        system({
          id: '3',
          name: 'red',
          hostname: '10.0.0.3',
          status: 'unreachable',
        }),
        system({
          id: '4',
          name: 'gray',
          hostname: '10.0.0.4',
          status: 'unprobed',
        }),
      ]),
    )
    render(<SystemsPage />)
    const greenRow = (await screen.findByText('green')).closest('tr')!
    expect(within(greenRow).getByLabelText(/Up to date/i)).toBeInTheDocument()
    const yellowRow = screen.getByText('yellow').closest('tr')!
    expect(within(yellowRow).getByLabelText(/Updates available/i)).toBeInTheDocument()
    const redRow = screen.getByText('red').closest('tr')!
    expect(within(redRow).getByLabelText(/Unreachable/i)).toBeInTheDocument()
    // The unprobed row gets no icon.
    const grayRow = screen.getByText('gray').closest('tr')!
    expect(within(grayRow).queryByLabelText(/Up to date/i)).toBeNull()
    expect(within(grayRow).queryByLabelText(/Updates available/i)).toBeNull()
    expect(within(grayRow).queryByLabelText(/Unreachable/i)).toBeNull()
  })

  it('refreshes the systems list after a kebab fan-out completes', async () => {
    vi.unstubAllGlobals()
    let listCalls = 0
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET') {
        listCalls++
        return Promise.resolve(
          jsonResponse([system({ id: '1', name: 'host-x', hostname: 'x.example' })]),
        )
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
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
      }
      if (url.endsWith('/check') && method === 'POST') {
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
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    const row = (await screen.findByText('host-x')).closest('tr')!
    const before = listCalls
    clickRowKebab(row, /^Check$/i)
    await screen.findByText(/Ran check on 1 system/i)
    // Initial mount fetch + one refresh after fan-out.
    expect(listCalls).toBeGreaterThan(before)
  })

  it('Update from the kebab banners a warning when no updaters are enabled', async () => {
    vi.unstubAllGlobals()
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([system({ id: '1', name: 'host-x', hostname: 'x.example' })]),
        )
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
        return Promise.resolve(jsonResponse({ updaters: [] }))
      }
      return Promise.resolve(jsonResponse({}, 500))
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    const row = (await screen.findByText('host-x')).closest('tr')!
    clickRowKebab(row, /^Update$/i)
    // Skipped row renders the reason inline next to the Skipped
    // label (no expandable body for skipped outcomes).
    expect(
      await screen.findByText(/No enabled updaters/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument()
  })
})
