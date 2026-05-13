// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuditPage from './AuditPage'

type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function record(overrides: Partial<{
  id: string
  occurredAt: string
  actorKind: 'user' | 'system' | 'unauthenticated'
  actorLabel: string
  action: string
  targetKind: string
  targetLabel: string
  outcome: 'success' | 'failure' | 'denied'
  detail: Record<string, unknown>
  requestId: string
  requestIp: string
}> = {}) {
  return {
    id: 'rec-1',
    occurredAt: '2026-05-01T00:00:00Z',
    actorKind: 'user' as const,
    actorLabel: 'alice',
    action: 'auth.login',
    outcome: 'success' as const,
    requestId: 'req-abc',
    ...overrides,
  }
}

function lastFetchURL(fetchMock: ReturnType<typeof vi.fn>): string {
  const calls = fetchMock.mock.calls as Array<[string, FetchInit]>
  return calls[calls.length - 1][0]
}

describe('AuditPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the empty state when there are no records', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    render(<AuditPage />)
    expect(await screen.findByText(/no audit records/i)).toBeInTheDocument()
  })

  it('renders rows with actor, action, target, outcome', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          record({
            id: 'a',
            actorLabel: 'alice',
            action: 'system.delete',
            targetKind: 'system',
            targetLabel: 'db-1',
            outcome: 'success',
          }),
          record({
            id: 'b',
            actorKind: 'unauthenticated',
            action: 'auth.login.failed',
            outcome: 'failure',
          }),
        ],
      }),
    )
    render(<AuditPage />)
    const rowA = (await screen.findByText('system.delete')).closest('tr')!
    expect(within(rowA).getByText('alice')).toBeInTheDocument()
    expect(within(rowA).getByText(/system: db-1/i)).toBeInTheDocument()
    expect(within(rowA).getByText('Success')).toBeInTheDocument()

    const rowB = screen.getByText('auth.login.failed').closest('tr')!
    expect(within(rowB).getByText('(unauthenticated)')).toBeInTheDocument()
    expect(within(rowB).getByText('Failure')).toBeInTheDocument()
  })

  it('requests 25 per page by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    render(<AuditPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(lastFetchURL(fetchMock)).toBe('/api/admin/audit?limit=25')
  })

  it('refetches with the new size when the page-size dropdown changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ records: [] }))
    render(<AuditPage />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /page size/i }))
    fireEvent.click(await screen.findByRole('option', { name: /100 per page/i }))

    await waitFor(() => {
      expect(lastFetchURL(fetchMock)).toBe('/api/admin/audit?limit=100')
    })
  })

  it('paginates forward via the keyset cursor and back resets it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          records: [record({ id: 'p1-a' }), record({ id: 'p1-b', action: 'auth.logout' })],
          next: { afterMs: 1700000000000, afterId: 'p1-b' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          records: [record({ id: 'p2-a', action: 'system.create' })],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          records: [record({ id: 'p1-a' }), record({ id: 'p1-b', action: 'auth.logout' })],
          next: { afterMs: 1700000000000, afterId: 'p1-b' },
        }),
      )

    render(<AuditPage />)
    expect(await screen.findByText('auth.logout')).toBeInTheDocument()
    expect(screen.getByText(/page 1/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    expect(await screen.findByText('system.create')).toBeInTheDocument()
    expect(
      lastFetchURL(fetchMock),
    ).toBe('/api/admin/audit?limit=25&after_ms=1700000000000&after_id=p1-b')
    expect(screen.getByText(/page 2/i)).toBeInTheDocument()
    // No further pages -> Next disabled.
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^previous$/i }))
    expect(await screen.findByText('auth.logout')).toBeInTheDocument()
    expect(screen.getByText(/page 1/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^previous$/i })).toBeDisabled()
  })

  it('disables Previous on page 1 and Next when no cursor is returned', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ records: [record()] }),
    )
    render(<AuditPage />)
    await screen.findByText('auth.login')
    expect(screen.getByRole('button', { name: /^previous$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()
  })

  it('expands a row to reveal the detail JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          record({
            id: 'r1',
            action: 'auth.login.failed',
            outcome: 'failure',
            detail: { attempted_username: 'bob', reason: 'wrong_password' },
            requestIp: '10.0.0.5:1234',
          }),
        ],
      }),
    )
    render(<AuditPage />)
    await screen.findByText('auth.login.failed')

    // PatternFly expand toggles have an accessible name like "Details".
    const toggle = screen.getAllByRole('button').find((b) =>
      /detail|expand/i.test(b.getAttribute('aria-label') ?? '') ||
      b.className.includes('expandable-row-toggle'),
    )!
    fireEvent.click(toggle)

    expect(await screen.findByText(/attempted_username/)).toBeInTheDocument()
    expect(screen.getByText(/wrong_password/)).toBeInTheDocument()
    expect(screen.getByText(/10\.0\.0\.5:1234/)).toBeInTheDocument()
  })

  it('shows an error alert when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<AuditPage />)
    expect(await screen.findByText(/could not load audit log/i)).toBeInTheDocument()
  })

  it('keeps Previous available when the next page returns no records', async () => {
    // Regression: if a stale next cursor lands on an empty page, the
    // paging toolbar must stay visible so the user can return to page 1.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          records: [record({ id: 'p1' })],
          next: { afterMs: 1, afterId: 'p1' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          records: [record({ id: 'p1' })],
          next: { afterMs: 1, afterId: 'p1' },
        }),
      )

    render(<AuditPage />)
    await screen.findByText('auth.login')
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))

    expect(await screen.findByText(/no more records/i)).toBeInTheDocument()
    const prev = screen.getByRole('button', { name: /^previous$/i })
    expect(prev).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled()

    fireEvent.click(prev)
    await screen.findByText('auth.login')
    expect(screen.getByText(/page 1/i)).toBeInTheDocument()
  })

  it('resets paging back to page 1 when the page size changes', async () => {
    // page 1, then forward to page 2, then change page size: should refetch
    // with the new size and no cursor (page 1).
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          records: [record({ id: 'p1' })],
          next: { afterMs: 1, afterId: 'p1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ records: [record({ id: 'p2', action: 'system.create' })] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ records: [record({ id: 'reset', action: 'system.delete' })] }),
      )

    render(<AuditPage />)
    await screen.findByText('auth.login')
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    await screen.findByText('system.create')

    fireEvent.click(screen.getByRole('button', { name: /page size/i }))
    fireEvent.click(await screen.findByRole('option', { name: /50 per page/i }))

    await screen.findByText('system.delete')
    expect(lastFetchURL(fetchMock)).toBe('/api/admin/audit?limit=50')
    expect(screen.getByText(/page 1/i)).toBeInTheDocument()
  })
})
