// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchUndecryptableSecrets } from './secrets'
import { ApiError } from './systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchUndecryptableSecrets', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed scan on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        count: 2,
        items: [
          {
            kind: 'user_totp',
            field: 'secret',
            targetId: 'u1',
            targetLabel: 'alice',
            keyVersion: 12345,
          },
          {
            kind: 'user_totp',
            field: 'pending',
            targetId: 'u2',
            targetLabel: 'bob',
            keyVersion: 12345,
          },
        ],
      }),
    )
    const out = await fetchUndecryptableSecrets()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/secrets/undecryptable')
    expect(out.count).toBe(2)
    expect(out.items).toHaveLength(2)
    expect(out.items[0].targetLabel).toBe('alice')
  })

  it('defaults missing count/items to zero/empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const out = await fetchUndecryptableSecrets()
    expect(out.count).toBe(0)
    expect(out.items).toEqual([])
  })

  it('throws ApiError on non-2xx with the server message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'scan requires Global Admin' }, 403),
    )
    await expect(fetchUndecryptableSecrets()).rejects.toBeInstanceOf(ApiError)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'scan requires Global Admin' }, 403),
    )
    await expect(fetchUndecryptableSecrets()).rejects.toMatchObject({
      status: 403,
      message: 'scan requires Global Admin',
    })
  })

  it('falls back to statusText when the body has no error field', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    )
    await expect(fetchUndecryptableSecrets()).rejects.toMatchObject({
      status: 500,
      message: 'Internal Server Error',
    })
  })
})
