// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemsPage from './SystemsPage'

type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function system(overrides: Partial<{ id: string; name: string; hostname: string; status: string; lastSeen: string }> = {}) {
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

describe('SystemsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows empty state with prompt to use the toolbar button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<SystemsPage />)
    expect(await screen.findByText(/no systems yet/i)).toBeInTheDocument()
    expect(
      screen.getByText(/add your first system with the button/i),
    ).toBeInTheDocument()
  })

  it('renders status labels and last-seen for each system', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        system({ id: '1', name: 'up', hostname: '10.0.0.1', status: 'reachable', lastSeen: '2026-05-05T12:00:00Z' }),
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
    expect(within(downRow).getByText('—')).toBeInTheDocument()
    expect(within(freshRow).getByText('—')).toBeInTheDocument()
  })

  it('opens the add modal, defaults Name from Hostname, and submits', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([])) // initial list
      .mockResolvedValueOnce(
        jsonResponse(system({ id: '1', name: 'srv.example.com', hostname: 'srv.example.com' }), 201),
      )
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '1', name: 'srv.example.com', hostname: 'srv.example.com' })]),
      )

    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add system/i }))

    const modal = await screen.findByRole('dialog')
    const hostnameInput = within(modal).getByLabelText(/hostname/i) as HTMLInputElement
    const nameInput = within(modal).getByLabelText(/^name/i) as HTMLInputElement

    fireEvent.change(hostnameInput, { target: { value: 'srv.example.com' } })
    // Name auto-defaults from hostname.
    expect(nameInput.value).toBe('srv.example.com')

    fireEvent.click(within(modal).getByRole('button', { name: /^add$/i }))

    // Same string appears in both Name and Hostname columns — assert at least one match.
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

    fireEvent.click(screen.getByRole('button', { name: /add system/i }))
    const modal = await screen.findByRole('dialog')
    const hostnameInput = within(modal).getByLabelText(/hostname/i)
    const nameInput = within(modal).getByLabelText(/^name/i) as HTMLInputElement

    fireEvent.change(hostnameInput, { target: { value: '10.0.0.5' } })
    expect(nameInput.value).toBe('10.0.0.5')
    fireEvent.change(nameInput, { target: { value: 'web prod' } })
    // Once Name is edited, further Hostname changes do NOT overwrite it.
    fireEvent.change(hostnameInput, { target: { value: '10.0.0.6' } })
    expect(nameInput.value).toBe('web prod')

    // Reset hostname so the submission matches the mock fixture.
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

    fireEvent.click(screen.getByRole('button', { name: /add system/i }))
    const modal = await screen.findByRole('dialog')
    fireEvent.change(within(modal).getByLabelText(/hostname/i), { target: { value: 'x' } })
    fireEvent.change(within(modal).getByLabelText(/^name/i), { target: { value: 'x' } })
    fireEvent.click(within(modal).getByRole('button', { name: /^add$/i }))

    expect(await within(modal).findByText(/hostname is required/i)).toBeInTheDocument()
    // The dialog is still rendered (the user can correct and retry).
    expect(screen.queryByRole('dialog')).toBeInTheDocument()
  })

  it('removes a system via the row delete button', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '1', name: 'doomed', hostname: '1.1.1.1' })]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))

    render(<SystemsPage />)
    const row = (await screen.findByText('doomed')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /remove doomed/i }))

    await waitFor(() =>
      expect(screen.getByText(/no systems yet/i)).toBeInTheDocument(),
    )

    const deleteCall = fetchMock.mock.calls[1] as [string, FetchInit]
    expect(deleteCall[0]).toBe('/api/systems/1')
    expect(deleteCall[1]?.method).toBe('DELETE')
  })

  it('refetches when a systems.changed event arrives', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([])) // initial: empty
      .mockResolvedValueOnce(
        jsonResponse([system({ id: '99', name: 'late-arrival', hostname: '10.0.0.99' })]),
      )

    render(<SystemsPage />)
    expect(await screen.findByText(/no systems yet/i)).toBeInTheDocument()

    // Simulate the backend pushing a systems.changed event.
    FakeEventSource.instances[0].emit('message', { type: 'systems.changed' })

    expect(await screen.findByText('late-arrival')).toBeInTheDocument()
    // Two GET /api/systems calls: initial + after event.
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/systems')).toHaveLength(2)
  })

  it('debounces bursts of events into a single refetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(<SystemsPage />)
    await waitFor(() => expect(screen.getByText(/no systems yet/i)).toBeInTheDocument())

    const initialCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/systems').length

    // Fire several events back-to-back.
    const es = FakeEventSource.instances[0]
    es.emit('message', { type: 'systems.changed' })
    es.emit('message', { type: 'systems.changed' })
    es.emit('message', { type: 'systems.changed' })

    // Wait for the debounce window (200ms) plus a margin.
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
})
