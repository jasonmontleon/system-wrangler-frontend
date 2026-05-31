// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchReadiness } from './readiness'

describe('fetchReadiness', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the JSON body on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'ready', checks: { database: 'ok' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const r = await fetchReadiness()
    expect(r).toEqual({ status: 'ready', checks: { database: 'ok' } })
  })

  it('still parses the body on 503 (not-ready uses the same shape)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'not_ready', checks: { database: 'closed' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const r = await fetchReadiness()
    expect(r.status).toBe('not_ready')
    expect(r.checks.database).toBe('closed')
  })

  it('sends the CSRF header', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ready', checks: {} }), {
        status: 200,
      }),
    )
    await fetchReadiness()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('X-Sw-Csrf')).toBe('1')
  })

  it('throws on unexpected status codes', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(fetchReadiness()).rejects.toThrow(/HTTP 500/)
  })
})
