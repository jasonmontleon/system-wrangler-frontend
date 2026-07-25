// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
    pendingPackages: Array<{
      name: string
      oldVersion: string
      newVersion: string
    }>
    lastRunFailed: boolean
    lastRunReason: string
    running: boolean
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

async function clickRowKebab(row: HTMLElement, label: RegExp) {
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
  })
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
      // useRebootGraceMs fetches this on mount; short-circuit it so the
      // mockResolvedValueOnce queue for /api/systems stays aligned.
      if (url === '/api/reboot-grace-seconds')
        return Promise.resolve(jsonResponse({ seconds: 120 }))
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
      row.querySelector('td[data-label="Updates"]') as HTMLElement
    // Never-checked systems show "Never" + "—".
    expect(lastChecked(downRow)).toHaveTextContent('Never')
    expect(updates(downRow)).toHaveTextContent('—')
    // Checked system shows a formatted date + the integer count.
    expect(lastChecked(upRow).textContent).not.toMatch(/^Never$/)
    expect(updates(upRow)).toHaveTextContent('3')
  })

  it('lights the row glyph when the sw_reboot_required metric reports the host (column NULL)', async () => {
    vi.stubGlobal('fetch', (input: FetchInput) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url === '/api/me/scope') return Promise.resolve(jsonResponse({ groups: {} }))
      if (url === '/api/systems') {
        return Promise.resolve(
          jsonResponse([
            system({
              id: 'fed-1',
              name: 'fed-1',
              hostname: 'fed-1.example',
              status: 'reachable',
              pendingUpdates: 0,
            }),
          ]),
        )
      }
      if (url.startsWith('/api/metrics/query')) {
        return Promise.resolve(
          jsonResponse({
            status: 'success',
            data: {
              resultType: 'vector',
              result: [{ metric: { system_id: 'fed-1' }, value: [0, '1'] }],
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}, 500))
    })
    render(<SystemsPage />)
    const row = (await screen.findByText('fed-1')).closest('tr')!
    await waitFor(() => {
      expect(within(row).getByLabelText('Reboot required')).toBeTruthy()
    })
    expect(within(row).queryByLabelText('Up to date')).toBeNull()
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
    await clickRowKebab(row, /remove doomed/i)

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

  it('sorts across non-name columns when their headers are clicked', async () => {
    const data = [
      system({ id: '1', name: 'a-name', hostname: '10.0.0.3', status: 'unreachable' }),
      system({ id: '2', name: 'b-name', hostname: '10.0.0.1', status: 'reachable' }),
      system({ id: '3', name: 'c-name', hostname: '10.0.0.2', status: 'unprobed' }),
    ]
    fetchMock.mockResolvedValueOnce(jsonResponse(data))
    render(<SystemsPage />)
    await screen.findByText('a-name')
    const clickHeader = (name: RegExp) => {
      const headers = screen.getAllByRole('columnheader', { name })
      const button = headers[0].querySelector('button')
      if (button) fireEvent.click(button)
    }
    // Each sortable header has a distinct sortKey branch; click each
    // to exercise the per-key comparator arm.
    clickHeader(/^Hostname/i)
    clickHeader(/^Labels/i)
    clickHeader(/^Group/i)
    clickHeader(/^Last checked/i)
    clickHeader(/^Updates/i)
    expect(screen.getByText('a-name')).toBeInTheDocument()
  })

  it('deselects every row after expanding the selection to all matching', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      system({ id: `s${i}`, name: `sys${i.toString().padStart(2, '0')}`, hostname: `10.0.0.${i}` }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(many))
    render(<SystemsPage />)
    await screen.findByText('sys00')
    const headerCheckbox = screen.getByRole('checkbox', { name: /select all/i })
    fireEvent.click(headerCheckbox)
    // The "Select all N matching" banner — click it to expand.
    const expand = await screen.findByRole('button', {
      name: /Select all 30 matching/i,
    })
    fireEvent.click(expand)
    // Now untick the header. Expanded selection clears wholesale.
    fireEvent.click(headerCheckbox)
    await waitFor(() => {
      const stillSelected = screen
        .queryAllByRole('checkbox', { checked: true })
        .filter((c) => c.getAttribute('aria-label')?.includes('row'))
      expect(stillSelected).toHaveLength(0)
    })
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

    // Multiple hooks subscribe to the SSE channel (the page itself
    // plus useLabelStyles); fan the event out across every fake
    // EventSource so any subscriber's refresh runs.
    FakeEventSource.instances.forEach((es) =>
      es.emit('message', { type: 'systems.changed' }),
    )
    expect(await screen.findByText('late-arrival')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/systems')).toHaveLength(2)
  })

  it('debounces bursts of events into a single refetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())

    const initialCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length

    const fan = (e: { type: string }) =>
      FakeEventSource.instances.forEach((es) => es.emit('message', e))
    await act(async () => {
      fan({ type: 'systems.changed' })
      fan({ type: 'systems.changed' })
      fan({ type: 'systems.changed' })
      await new Promise((r) => setTimeout(r, 300))
    })

    const newCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length
    expect(newCalls - initialCalls).toBe(1)
  })

  it('ignores events of unknown types', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())
    const initialCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length

    await act(async () => {
      FakeEventSource.instances[0].emit('message', { type: 'something.else' })
      await new Promise((r) => setTimeout(r, 300))
    })

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
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
    })
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
    await clickRowKebab(row, /^Check$/i)
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
    await clickRowKebab(row, /^Check$/i)

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

  it('shows a row spinner and counts toolbar pill when the backend reports running=true for work started elsewhere', async () => {
    // Phase 2 of SSE: the listSystems response carries `running:true`
    // for systems whose advisory lock is held — even if this tab
    // didn't kick off the work. The row must show a spinner and the
    // toolbar pill must include it in the busy count so the spinner
    // persists across navigation.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: '1', name: 'busy-elsewhere', running: true }),
        system({ id: '2', name: 'idle' }),
      ]),
    )
    render(<SystemsPage />)
    const busyRow = (await screen.findByText('busy-elsewhere')).closest('tr')!
    expect(
      within(busyRow).getByLabelText(/Run in progress/i),
    ).toBeInTheDocument()
    const idleRow = screen.getByText('idle').closest('tr')!
    expect(within(idleRow).queryByLabelText(/Run in progress/i)).toBeNull()
    expect(
      screen.getByLabelText(/In-flight tasks/i).textContent,
    ).toMatch(/1 task running/i)
  })

  it('skips unreachable systems in a bulk fan-out instead of POSTing against them', async () => {
    vi.unstubAllGlobals()
    const checkCalls: string[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET')
        return Promise.resolve(
          jsonResponse([
            system({ id: 'alive-1', name: 'alive', status: 'reachable' }),
            system({ id: 'dead-1', name: 'dead', status: 'unreachable' }),
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
    await screen.findByText('alive')
    const checkboxes = screen.getAllByRole('checkbox', { name: /select row/i })
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Check selected/i }))
    await waitFor(() => expect(checkCalls).toHaveLength(1))
    expect(checkCalls[0]).toContain('/systems/alive-1/')
    const card = await screen.findByLabelText(/Updater action results/i)
    expect(
      within(card).getByText(/System is marked unreachable/i),
    ).toBeInTheDocument()
  })

  it('renders the fan-out results as a fixed-position overlay that does not shift layout', async () => {
    vi.unstubAllGlobals()
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
    await clickRowKebab(row, /^Check$/i)
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
      await clickRowKebab(row, /^Check$/i)
      const card = await screen.findByLabelText(/Updater action results/i)
      expect(card).toBeInTheDocument()
      // Advance past the 8s auto-dismiss window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100)
      })
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
      await clickRowKebab(row, /^Check$/i)
      const card = await screen.findByLabelText(/Updater action results/i)
      const wrapper = card.parentElement as HTMLElement
      fireEvent.mouseEnter(wrapper)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100)
      })
      // Still present despite the idle window having passed.
      expect(
        screen.getByLabelText(/Updater action results/i),
      ).toBeInTheDocument()
      // Leaving restarts the window; advancing through it clears the panel.
      fireEvent.mouseLeave(wrapper)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100)
      })
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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

  it('allows a bulk Check on an idle selection while an unselected system is busy', async () => {
    vi.unstubAllGlobals()
    const checkCalls: string[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([
            // host-a has a run in flight started elsewhere (running:true);
            // host-b is idle. host-a is never selected.
            system({ id: 'a', name: 'host-a', hostname: 'a.example', running: true }),
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
    // The busy host elsewhere surfaces the global pill, but it must not
    // disable a bulk action scoped to an idle selection.
    const rowB = (await screen.findByText('host-b')).closest('tr')!
    fireEvent.click(within(rowB).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    const checkItem = screen.getByRole('menuitem', { name: /Check selected/i })
    expect(checkItem).not.toBeDisabled()
    fireEvent.click(checkItem)
    await waitFor(() => expect(checkCalls).toHaveLength(1))
    // Only the selected idle host is acted on; the busy one is untouched.
    expect(checkCalls.every((u) => u.includes('/systems/b/'))).toBe(true)
  })

  it('refuses a bulk Check when a selected system is still busy', async () => {
    vi.unstubAllGlobals()
    const checkCalls: string[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([
            system({ id: 'a', name: 'host-a', hostname: 'a.example', running: true }),
          ]),
        )
      }
      if (url.endsWith('/check') && method === 'POST') {
        checkCalls.push(url)
        return Promise.resolve(jsonResponse({}))
      }
      return Promise.resolve(jsonResponse({}, 500))
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    const rowA = (await screen.findByText('host-a')).closest('tr')!
    fireEvent.click(within(rowA).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^Actions$/i }))
    // findBy lets the menu's Popper positioning settle inside act before
    // we assert, instead of leaking the update past the test.
    const checkItem = await screen.findByRole('menuitem', { name: /Check selected/i })
    // The selected host is busy, so the bulk action is disabled and a
    // click must not fan out a check.
    expect(checkItem).toBeDisabled()
    fireEvent.click(checkItem)
    await Promise.resolve()
    expect(checkCalls).toHaveLength(0)
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
          pendingPackages: [
            { name: 'kernel', oldVersion: '6.8.0-31', newVersion: '6.8.0-45' },
            { name: 'glibc', oldVersion: '2.39-1', newVersion: '2.39-3' },
          ],
        }),
      ]),
    )
    render(<SystemsPage />)
    const row = (await screen.findByText('busy')).closest('tr')!
    const cell = row.querySelector(
      'td[data-label="Updates"]',
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
    // Version transition is rendered alongside each package name.
    expect(
      await screen.findByText(/6\.8\.0-31\s+→\s+6\.8\.0-45/),
    ).toBeInTheDocument()
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
      'td[data-label="Updates"]',
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
    await clickRowKebab(row, /^Check$/i)
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
      if (url.startsWith('/api/label-styles')) return Promise.resolve(jsonResponse({}))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url === '/api/systems/bulk-event') return Promise.resolve(new Response(null, { status: 204 }))
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
    await clickRowKebab(row, /^Update$/i)
    // Skipped row renders the reason inline next to the Skipped
    // label (no expandable body for skipped outcomes).
    expect(
      await screen.findByText(/No enabled updaters/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument()
  })

  // renderAt wraps SystemsPage in a MemoryRouter seeded to a specific
  // URL so the `?labels=` round-trip can be verified end-to-end.
  function renderAt(url: string) {
    return rtlRender(
      <MemoryRouter initialEntries={[url]}>
        <SystemsPage />
      </MemoryRouter>,
    )
  }

  it('seeds the label selector input from the ?labels= URL param', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: '1',
          name: 'a',
          hostname: 'a.example',
          status: 'reachable',
        }),
      ]),
    )
    renderAt('/?labels=env%3Dprod')
    // The first fetch the page issues for /api/systems must already
    // carry the URL-seeded selector — readers shouldn't see an
    // unfiltered flash on mount.
    await waitFor(() => {
      const calls = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.startsWith('/api/systems?'))
      expect(calls).toContain('/api/systems?labels=env%3Dprod')
    })
    const input = screen.getByLabelText(/label selector/i) as HTMLInputElement
    expect(input.value).toBe('env=prod')
  })

  it('refetches with the new selector after the user types one', async () => {
    // Seed with a row so the table (and its column-level filter input)
    // renders. The empty state hides the table — accessing the label
    // selector via that path is covered by `seeds the label selector
    // input from the ?labels= URL param` above.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: '1', name: 'a', hostname: 'a.example', status: 'reachable' }),
      ]),
    )
    render(<SystemsPage />)
    const input = await screen.findByLabelText(/label selector/i)
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    fireEvent.change(input, { target: { value: 'env=prod' } })
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u === '/api/systems?labels=env%3Dprod')).toBe(true)
    })
  })

  it('surfaces a backend 400 (invalid selector) as a load error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid labels selector: empty requirement' }, 400),
    )
    renderAt('/?labels=,')
    expect(
      await screen.findByText(/invalid labels selector/i),
    ).toBeInTheDocument()
  })

  it('clicking a user-label chip appends its token to the selector', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({
          id: '1',
          name: 'a',
          hostname: 'a.example',
          status: 'reachable',
        }),
      ]),
    )
    // Seed the response so the row has a clickable env=prod chip.
    // jsonResponse stringifies the body so we have to mutate the
    // serialized form — easier to just rebuild via a custom mock.
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: '1',
            name: 'a',
            hostname: 'a.example',
            createdAt: 't',
            status: 'reachable',
            labels: [{ key: 'env', value: 'prod' }],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    // Subsequent fetches (after the chip click triggers a refresh)
    // return an empty list — the test asserts on the URL, not the
    // body.
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<SystemsPage />)
    const chip = await screen.findByText('env=prod')
    fireEvent.click(chip)
    const input = screen.getByLabelText(/label selector/i) as HTMLInputElement
    expect(input.value).toBe('env=prod')
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]))
      expect(urls.some((u) => u === '/api/systems?labels=env%3Dprod')).toBe(true)
    })
  })

  it('does not duplicate a chip token already in the selector', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: '1',
            name: 'a',
            hostname: 'a.example',
            createdAt: 't',
            status: 'reachable',
            labels: [{ key: 'env', value: 'prod' }],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    fetchMock.mockResolvedValue(jsonResponse([]))
    renderAt('/?labels=env%3Dprod')
    const chip = await screen.findByText('env=prod')
    fireEvent.click(chip)
    fireEvent.click(chip)
    const input = screen.getByLabelText(/label selector/i) as HTMLInputElement
    expect(input.value).toBe('env=prod')
  })

  it('shows "Select all N matching" when only the visible page is selected', async () => {
    // Seed 30 systems so the default page size of 25 leaves rows on
    // page 2. Selecting the page-header checkbox then triggers the
    // Gmail-style expand affordance.
    const many = Array.from({ length: 30 }, (_, i) =>
      system({
        id: `s${i}`,
        name: `host-${i}`,
        hostname: `${i}.example`,
        status: 'reachable',
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(many))
    render(<SystemsPage />)
    await screen.findByText('host-0')

    // Header select-all is the very first checkbox in the table.
    const headerCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(headerCheckbox)

    const banner = await screen.findByText(/select all 30 matching systems/i)
    expect(banner).toBeInTheDocument()
    // Banner counts page rows (25) on this default-page-sized table.
    expect(screen.getByText(/25 selected on this page/i)).toBeInTheDocument()
  })

  it('expands the selection to every matching row when the banner is clicked', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      system({
        id: `s${i}`,
        name: `host-${i}`,
        hostname: `${i}.example`,
        status: 'reachable',
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(many))
    render(<SystemsPage />)
    await screen.findByText('host-0')

    const headerCheckbox = screen.getAllByRole('checkbox')[0]
    fireEvent.click(headerCheckbox)
    fireEvent.click(
      await screen.findByRole('button', {
        name: /select all 30 matching systems/i,
      }),
    )
    // After expansion, the banner condition is false — banner gone.
    expect(
      screen.queryByText(/select all 30 matching systems/i),
    ).not.toBeInTheDocument()
  })

  it('clears off-page selections when the header check is unticked after a banner expand', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      system({
        id: `s${i}`,
        name: `host-${i}`,
        hostname: `${i}.example`,
        status: 'reachable',
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(many))
    render(<SystemsPage />)
    await screen.findByText('host-0')

    const headerCheckbox = () => screen.getAllByRole('checkbox')[0]
    fireEvent.click(headerCheckbox())
    fireEvent.click(
      await screen.findByRole('button', {
        name: /select all 30 matching systems/i,
      }),
    )

    // Untick the header check. Because every matching row is in
    // the set (banner expanded), this should wipe the entire
    // selection — not just the visible 25.
    fireEvent.click(headerCheckbox())

    // Re-ticking should land us back in the page-only state — the
    // banner reappears because not every matching row is selected
    // yet.
    fireEvent.click(headerCheckbox())
    expect(
      await screen.findByText(/select all 30 matching systems/i),
    ).toBeInTheDocument()
  })

  it('bulk Add label PUTs the chosen key=value across selected systems', async () => {
    vi.unstubAllGlobals()
    const labelPuts: { url: string; body: string }[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url === '/api/systems/bulk-event')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([
            system({ id: 'a', name: 'host-a', hostname: 'a.example' }),
            system({ id: 'b', name: 'host-b', hostname: 'b.example' }),
          ]),
        )
      }
      if (url.match(/^\/api\/systems\/[^/]+\/labels\/[^/]+$/) && method === 'PUT') {
        labelPuts.push({ url, body: String(init?.body ?? '') })
        return Promise.resolve(
          jsonResponse({ key: 'env', value: 'prod' }),
        )
      }
      return Promise.resolve(jsonResponse({}, 500))
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    await screen.findByText('host-a')

    // Select all rows via the header checkbox.
    fireEvent.click(screen.getAllByRole('checkbox')[0])

    // Open the Actions menu and pick "Add label..."
    fireEvent.click(screen.getByRole('button', { name: /^actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /add label/i }))

    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'env=prod' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(labelPuts.length).toBe(2))
    expect(labelPuts.map((p) => p.url).sort()).toEqual([
      '/api/systems/a/labels/env',
      '/api/systems/b/labels/env',
    ])
    expect(JSON.parse(labelPuts[0].body)).toEqual({ value: 'prod' })
    // Success Alert reports the count.
    expect(
      await screen.findByText(/added env=prod to 2 systems/i),
    ).toBeInTheDocument()
  })

  it('bulk Remove label DELETEs the key and 404s land as skipped', async () => {
    vi.unstubAllGlobals()
    const deletes: string[] = []
    const wrapped = (input: FetchInput, init?: FetchInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url === '/api/me/scope')
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url.startsWith('/api/groups')) return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/label-styles'))
        return Promise.resolve(jsonResponse({}))
      if (url === '/api/systems/bulk-event')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/systems' && method === 'GET') {
        return Promise.resolve(
          jsonResponse([
            system({ id: 'a', name: 'host-a', hostname: 'a.example' }),
            system({ id: 'b', name: 'host-b', hostname: 'b.example' }),
          ]),
        )
      }
      if (url.match(/^\/api\/systems\/[^/]+\/labels\/[^/]+$/) && method === 'DELETE') {
        deletes.push(url)
        // host-a has the label, host-b doesn't (404 → skipped).
        if (url === '/api/systems/b/labels/env') {
          return Promise.resolve(jsonResponse({ error: 'not found' }, 404))
        }
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonResponse({}, 500))
    }
    vi.stubGlobal('fetch', wrapped)
    vi.stubGlobal('EventSource', FakeEventSource)

    render(<SystemsPage />)
    await screen.findByText('host-a')

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: /^actions$/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /remove label/i }))

    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'env' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }))

    await waitFor(() => expect(deletes.length).toBe(2))
    expect(
      await screen.findByText(/removed env from 1 system/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument()
  })
})
