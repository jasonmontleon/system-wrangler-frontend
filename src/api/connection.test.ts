// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testConnection } from './connection'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('connection api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('testConnection POSTs and parses the result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'success',
        reason: 'pong',
        exitCode: 0,
        durationMs: 312,
      }),
    )
    const got = await testConnection('host-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/host-1/test-connection')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(got.status).toBe('success')
    expect(got.reason).toBe('pong')
  })

  it('testConnection raises ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 503 }))
    await expect(testConnection('host-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('falls back to statusText / HTTP code when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('plain text', { status: 503, statusText: 'Service Unavailable' }),
    )
    await expect(testConnection('host-1')).rejects.toThrow('Service Unavailable')
  })

  it('falls back to "HTTP <status>" when statusText is empty and body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('plain text', { status: 522, statusText: '' }),
    )
    await expect(testConnection('host-1')).rejects.toThrow('HTTP 522')
  })

  it('encodes the system id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', reason: 'pong', exitCode: 0, durationMs: 0 }),
    )
    await testConnection('host/1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/host%2F1/test-connection')
  })
})
