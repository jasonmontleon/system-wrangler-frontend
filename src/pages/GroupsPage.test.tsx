// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupsPage from './GroupsPage'

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
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) =>
      (fetchMock as unknown as typeof fetch)(input, init),
    )
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the empty state when no groups exist', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    render(<GroupsPage onOpenGroup={() => {}} />)
    expect(await screen.findByText(/no system groups yet/i)).toBeInTheDocument()
  })

  it('renders rows with system count and lets the user click into a group', async () => {
    const onOpen = vi.fn()
    fetchMock.mockResolvedValueOnce(
      jsonResponse([group({ id: 'g-1', name: 'prod', systemCount: 3 })]),
    )
    render(<GroupsPage onOpenGroup={onOpen} />)
    const row = (await screen.findByText('prod')).closest('tr')!
    expect(within(row).getByText('3')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'prod' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].id).toBe('g-1')
  })

  it('creates a group via the Add modal', async () => {
    const created = group({ id: 'g-1', name: 'staging' })
    fetchMock
      .mockResolvedValueOnce(jsonResponse([])) // initial list
      .mockResolvedValueOnce(jsonResponse(created, 201)) // create
      .mockResolvedValueOnce(jsonResponse([created])) // refetch
    render(<GroupsPage onOpenGroup={() => {}} />)
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

  it('surfaces an error when load fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500))
    render(<GroupsPage onOpenGroup={() => {}} />)
    expect(
      await screen.findByText(/could not load system groups/i),
    ).toBeInTheDocument()
  })
})
