// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuditPage from './AuditPage'

// useScope fires a /api/me/scope fetch on mount. Default the existing
// tests to a non-admin scope so the Clear button stays hidden and the
// fetchMock queue is reserved for /api/admin/audit calls. The two
// tests that exercise the Clear button re-mock useScope locally.
type ScopeReturn = ReturnType<
  typeof import('../hooks/useScope').useScope
>
const useScopeMock = vi.fn<() => ScopeReturn>()
vi.mock('../hooks/useScope', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useScope')>(
    '../hooks/useScope',
  )
  return {
    ...actual,
    useScope: () => useScopeMock(),
  }
})

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
    useScopeMock.mockReset()
    useScopeMock.mockReturnValue({
      state: { kind: 'ready', scope: { global: '', groups: {} } },
      refresh: vi.fn(async () => undefined),
    })
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

  it('sorts across Actor, Action, Target, Outcome, Request ID columns', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          record({
            id: 'r1',
            actorLabel: 'alice',
            action: 'login',
            targetKind: 'user',
            targetLabel: 'u1',
            outcome: 'success',
            requestId: 'req-zzz',
          }),
          record({
            id: 'r2',
            actorLabel: 'bob',
            action: 'logout',
            targetKind: 'user',
            targetLabel: 'u2',
            outcome: 'failure',
            requestId: 'req-aaa',
          }),
        ],
      }),
    )
    render(<AuditPage />)
    await screen.findByText('alice')
    const clickHeader = (name: RegExp) => {
      const headers = screen.getAllByRole('columnheader', { name })
      const button = headers[0].querySelector('button')
      if (button) fireEvent.click(button)
    }
    clickHeader(/^Actor$/i)
    clickHeader(/^Action$/i)
    clickHeader(/^Target$/i)
    clickHeader(/^Outcome$/i)
    clickHeader(/^Request ID/i)
    expect(screen.getByText('alice')).toBeInTheDocument()
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

  // alwaysOneRecord installs a fetch handler that returns a single
  // audit record on every call. Used by the filter tests where the
  // table needs to stay rendered (and therefore the filter row
  // accessible) across multiple refetches; Response bodies can only
  // be consumed once, so a single mockResolvedValue is exhausted
  // after the first await.
  function alwaysOneRecord() {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ records: [record()] })),
    )
  }

  it('sends filter inputs to the backend after debounce', async () => {
    alwaysOneRecord()
    render(<AuditPage />)
    await screen.findByText('auth.login')

    fireEvent.change(screen.getByLabelText(/filter actor/i), {
      target: { value: 'alice' },
    })
    await waitFor(() => {
      expect(lastFetchURL(fetchMock)).toContain('actor_label=alice')
    })
    // action gets a trailing '*' auto-appended so partial typing is
    // treated as a prefix.
    fireEvent.change(screen.getByLabelText(/filter action/i), {
      target: { value: 'auth' },
    })
    await waitFor(() => {
      expect(lastFetchURL(fetchMock)).toContain('action=auth*')
    })
  })

  it('parses YYYY-MM-DD into a since/until day range', async () => {
    alwaysOneRecord()
    render(<AuditPage />)
    await screen.findByText('auth.login')

    fireEvent.change(screen.getByLabelText(/filter time/i), {
      target: { value: '2026-05-15' },
    })
    await waitFor(() => {
      const url = lastFetchURL(fetchMock)
      const since = Date.parse('2026-05-15T00:00:00Z')
      expect(url).toContain('since=' + since)
      expect(url).toContain('until=' + (since + 24 * 60 * 60 * 1000))
    })
  })

  it('only filters by outcome when the input resolves to a known value', async () => {
    alwaysOneRecord()
    render(<AuditPage />)
    await screen.findByText('auth.login')

    // Partial input "s" matches "success" prefix uniquely → sent.
    fireEvent.change(screen.getByLabelText(/filter outcome/i), {
      target: { value: 's' },
    })
    await waitFor(() => {
      expect(lastFetchURL(fetchMock)).toContain('outcome=success')
    })
    // Ambiguous prefix "f" only matches "failure" → still sent.
    fireEvent.change(screen.getByLabelText(/filter outcome/i), {
      target: { value: 'f' },
    })
    await waitFor(() => {
      expect(lastFetchURL(fetchMock)).toContain('outcome=failure')
    })
    // "x" matches no known outcome → param is dropped.
    fireEvent.change(screen.getByLabelText(/filter outcome/i), {
      target: { value: 'x' },
    })
    await waitFor(() => {
      expect(lastFetchURL(fetchMock)).not.toContain('outcome=')
    })
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

  it('shows the Clear audit log button for global admins and walks through the modal', async () => {
    useScopeMock.mockReturnValue({
      state: { kind: 'ready', scope: { global: 'admin', groups: {} } },
      refresh: vi.fn(async () => undefined),
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ records: [] }))
      .mockResolvedValueOnce(jsonResponse({ rowsDeleted: 7 }))
      .mockResolvedValueOnce(jsonResponse({ records: [] }))

    render(<AuditPage />)
    const clearBtn = await screen.findByRole('button', { name: /^Clear audit log$/i })
    fireEvent.click(clearBtn)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Clear rows older than/i }))
    const daysInput = within(dialog).getByLabelText(/^Days$/i) as HTMLInputElement
    fireEvent.change(daysInput, { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^Clear$/i }))

    expect(await within(dialog).findByText(/7 rows deleted/i)).toBeInTheDocument()

    const deleteCall = (fetchMock.mock.calls as Array<[string, FetchInit]>).find(
      (c) =>
        String(c[0]).startsWith('/api/admin/audit') &&
        (c[1] as RequestInit | undefined)?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    expect(String(deleteCall![0])).toBe('/api/admin/audit?older_than_days=30')
  })

  it('hides the Clear audit log button when the caller is not a global admin', async () => {
    useScopeMock.mockReturnValue({
      state: { kind: 'ready', scope: { global: 'operator', groups: {} } },
      refresh: vi.fn(async () => undefined),
    })
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    render(<AuditPage />)
    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
    })
    expect(
      screen.queryByRole('button', { name: /^Clear audit log$/i }),
    ).not.toBeInTheDocument()
  })
})
