// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createHost, deleteHost, listHosts } from './hosts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('hosts api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listHosts hits /api/hosts and returns the array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 'a', name: 'h', hostname: '1.1.1.1', createdAt: 't' }]),
    )
    const hosts = await listHosts()
    expect(fetchMock).toHaveBeenCalledWith('/api/hosts')
    expect(hosts).toHaveLength(1)
    expect(hosts[0].id).toBe('a')
  })

  it('createHost posts JSON', async () => {
    const created = {
      id: 'a',
      name: 'h',
      hostname: '1.1.1.1',
      createdAt: 't',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(created, { status: 201 }))
    const out = await createHost({ name: 'h', hostname: '1.1.1.1' })
    expect(out).toEqual(created)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/hosts')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'h', hostname: '1.1.1.1' })
  })

  it('deleteHost issues DELETE with encoded id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteHost('a/b')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/hosts/a%2Fb')
    expect(init.method).toBe('DELETE')
  })

  it('throws ApiError with backend error message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'name is required' }, { status: 400 }))
    await expect(createHost({ name: '', hostname: 'x' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'name is required',
    })
  })

  it('falls back to statusText when body has no error field', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
    )
    await expect(listHosts()).rejects.toBeInstanceOf(ApiError)
  })
})
