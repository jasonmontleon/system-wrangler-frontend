// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HostsPage from './HostsPage'

type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function host(overrides: Partial<{ id: string; name: string; hostname: string; status: string; lastSeen: string }> = {}) {
  return {
    id: '1',
    name: 'host-1',
    hostname: '10.0.0.1',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'unprobed' as const,
    ...overrides,
  }
}

describe('HostsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows empty state with prompt to use the toolbar button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<HostsPage />)
    expect(await screen.findByText(/no hosts yet/i)).toBeInTheDocument()
    expect(
      screen.getByText(/add your first host with the button/i),
    ).toBeInTheDocument()
  })

  it('renders status labels and last-seen for each host', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        host({ id: '1', name: 'up', hostname: '10.0.0.1', status: 'reachable', lastSeen: '2026-05-05T12:00:00Z' }),
        host({ id: '2', name: 'down', hostname: '10.0.0.2', status: 'unreachable' }),
        host({ id: '3', name: 'fresh', hostname: '10.0.0.3', status: 'unprobed' }),
      ]),
    )
    render(<HostsPage />)
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
        jsonResponse(host({ id: '1', name: 'srv.example.com', hostname: 'srv.example.com' }), 201),
      )
      .mockResolvedValueOnce(
        jsonResponse([host({ id: '1', name: 'srv.example.com', hostname: 'srv.example.com' })]),
      )

    render(<HostsPage />)
    await waitFor(() => expect(screen.getByText(/no hosts yet/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add host/i }))

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
    expect(postCall[0]).toBe('/api/hosts')
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
        jsonResponse(host({ id: '1', name: 'web prod', hostname: '10.0.0.5' }), 201),
      )
      .mockResolvedValueOnce(
        jsonResponse([host({ id: '1', name: 'web prod', hostname: '10.0.0.5' })]),
      )

    render(<HostsPage />)
    await waitFor(() => expect(screen.getByText(/no hosts yet/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add host/i }))
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

    render(<HostsPage />)
    await waitFor(() => expect(screen.getByText(/no hosts yet/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /add host/i }))
    const modal = await screen.findByRole('dialog')
    fireEvent.change(within(modal).getByLabelText(/hostname/i), { target: { value: 'x' } })
    fireEvent.change(within(modal).getByLabelText(/^name/i), { target: { value: 'x' } })
    fireEvent.click(within(modal).getByRole('button', { name: /^add$/i }))

    expect(await within(modal).findByText(/hostname is required/i)).toBeInTheDocument()
    // The dialog is still rendered (the user can correct and retry).
    expect(screen.queryByRole('dialog')).toBeInTheDocument()
  })

  it('removes a host via the row delete button', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([host({ id: '1', name: 'doomed', hostname: '1.1.1.1' })]),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse([]))

    render(<HostsPage />)
    const row = (await screen.findByText('doomed')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /remove doomed/i }))

    await waitFor(() =>
      expect(screen.getByText(/no hosts yet/i)).toBeInTheDocument(),
    )

    const deleteCall = fetchMock.mock.calls[1] as [string, FetchInit]
    expect(deleteCall[0]).toBe('/api/hosts/1')
    expect(deleteCall[1]?.method).toBe('DELETE')
  })

  it('shows a load error when the list request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<HostsPage />)
    expect(await screen.findByText(/could not load hosts/i)).toBeInTheDocument()
  })
})
