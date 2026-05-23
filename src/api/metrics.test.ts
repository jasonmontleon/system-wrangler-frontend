// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { query, queryRange } from './metrics'
import { ApiError } from './systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('metrics api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('query returns the result vector', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [{ metric: { job: 'x' }, value: [1716_000_000, '1.5'] }],
        },
      }),
    )
    const got = await query('node_load1')
    expect(got).toHaveLength(1)
    expect(got[0].value[1]).toBe('1.5')
  })

  it('query sends time parameter when provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
    )
    await query('up', 1716_000_000)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('time=1716000000')
  })

  it('query throws ApiError on non-200', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'bad query' }, 400),
    )
    await expect(query('bogus')).rejects.toBeInstanceOf(ApiError)
  })

  it('query throws on prom-status-error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'error', error: 'parse failure' }),
    )
    await expect(query('bogus')).rejects.toBeInstanceOf(ApiError)
  })

  it('queryRange forwards start/end/step', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            { metric: { job: 'x' }, values: [[1716_000_000, '0.1'], [1716_000_015, '0.2']] },
          ],
        },
      }),
    )
    const got = await queryRange('node_load1', 1716_000_000, 1716_000_300, 15)
    expect(got).toHaveLength(1)
    expect(got[0].values).toHaveLength(2)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('start=1716000000')
    expect(url).toContain('end=1716000300')
    expect(url).toContain('step=15')
  })
})
