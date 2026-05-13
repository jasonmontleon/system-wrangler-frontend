// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listAudit } from './audit'
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
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/audit')
  })

  it('serializes limit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await listAudit({ limit: 50 })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/audit?limit=50')
  })

  it('serializes the cursor', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [] }))
    await listAudit({
      limit: 25,
      after: { afterMs: 1700000000000, afterId: 'abc-123' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/audit?limit=25&after_ms=1700000000000&after_id=abc-123',
    )
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
