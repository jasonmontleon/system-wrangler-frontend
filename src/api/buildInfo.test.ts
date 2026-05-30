// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBuildInfo } from './buildInfo'

describe('fetchBuildInfo', () => {
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
        JSON.stringify({
          backend: 'abc1234',
          frontend: 'def5678',
          buildDate: '2026-05-29T22:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const info = await fetchBuildInfo()
    expect(info).toEqual({
      backend: 'abc1234',
      frontend: 'def5678',
      buildDate: '2026-05-29T22:00:00Z',
    })
  })

  it('sends the CSRF header', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ backend: 'a', frontend: 'b', buildDate: 'c' }), {
        status: 200,
      }),
    )
    await fetchBuildInfo()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('X-Sw-Csrf')).toBe('1')
  })

  it('throws on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(fetchBuildInfo()).rejects.toThrow(/HTTP 503/)
  })
})
