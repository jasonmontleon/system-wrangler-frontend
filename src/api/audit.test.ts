// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAudit, listAudit } from './audit'
import { ApiError } from './systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('listAudit', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues a bare GET when no params are set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await listAudit()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit')
  })

  it('serializes limit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await listAudit({ limit: 50 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit?limit=50')
  })

  it('serializes the cursor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await listAudit({
      limit: 25,
      after: { afterMs: 1700000000000, afterId: 'abc-123' },
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/admin/audit?limit=25&after_ms=1700000000000&after_id=abc-123',
    )
  })

  it('serializes filter params with snake_case keys', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await listAudit({
      action: 'auth.*',
      actorLabel: 'alice',
      targetLabel: 'db-',
      outcome: 'failure',
      requestId: 'req-xyz',
      sinceMs: 1700000000000,
      untilMs: 1700000099999,
    })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url.startsWith('/api/admin/audit?')).toBe(true)
    expect(url).toContain('action=auth.*')
    expect(url).toContain('actor_label=alice')
    expect(url).toContain('target_label=db-')
    expect(url).toContain('outcome=failure')
    expect(url).toContain('request_id=req-xyz')
    expect(url).toContain('since=1700000000000')
    expect(url).toContain('until=1700000099999')
  })

  it('omits empty and undefined filter params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await listAudit({
      action: '',
      actorLabel: undefined,
      outcome: undefined,
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit')
  })

  it('returns the parsed response on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        records: [
          {
            id: 'rec-1',
            occurredAt: '2026-05-01T00:00:00Z',
            actorKind: 'user',
            action: 'auth.login',
            outcome: 'success',
          },
        ],
        next: { afterMs: 123, afterId: 'rec-1' },
      }),
    )
    const out = await listAudit()
    expect(out.records).toHaveLength(1)
    expect(out.records[0].action).toBe('auth.login')
    expect(out.next?.afterId).toBe('rec-1')
  })

  it('throws ApiError with the server error message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    await expect(listAudit()).rejects.toBeInstanceOf(ApiError)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    await expect(listAudit()).rejects.toMatchObject({ status: 403, message: 'forbidden' })
  })

  it('falls back to statusText when the body has no error field', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    )
    await expect(listAudit()).rejects.toMatchObject({ status: 500, message: 'Internal Server Error' })
  })
})

describe('clearAudit', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues a bare DELETE when no parameter is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rowsDeleted: 42 }))
    const out = await clearAudit()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit')
    expect((fetchMock.mock.calls[0][1] as RequestInit | undefined)?.method).toBe('DELETE')
    expect(out.rowsDeleted).toBe(42)
  })

  it('serializes older_than_days', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rowsDeleted: 3 }))
    await clearAudit(90)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/audit?older_than_days=90')
  })

  it('throws ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    await expect(clearAudit()).rejects.toBeInstanceOf(ApiError)
  })
})
