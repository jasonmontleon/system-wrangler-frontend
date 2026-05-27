// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createSystem, deleteSystem, listSystems } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('systems api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listSystems hits /api/systems and returns the array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 'a', name: 'h', hostname: '1.1.1.1', createdAt: 't' }]),
    )
    const systems = await listSystems()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems')
    expect(systems).toHaveLength(1)
    expect(systems[0].id).toBe('a')
  })

  it('listSystems appends ?labels= when a selector is supplied', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listSystems({ labels: 'env=prod,role!=cache' })
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/systems?labels=env%3Dprod%2Crole!%3Dcache',
    )
  })

  it('listSystems skips ?labels= for whitespace-only selectors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listSystems({ labels: '   ' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems')
  })

  it('listSystems decodes inline labels on each row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 'a',
          name: 'h',
          hostname: '1.1.1.1',
          createdAt: 't',
          status: 'reachable',
          labels: [
            { key: 'env', value: 'prod' },
            { key: 'oncall', value: null },
          ],
        },
      ]),
    )
    const systems = await listSystems()
    expect(systems[0].labels).toHaveLength(2)
    expect(systems[0].labels?.[1].value).toBeNull()
  })

  it('createSystem posts JSON', async () => {
    const created = {
      id: 'a',
      name: 'h',
      hostname: '1.1.1.1',
      createdAt: 't',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(created, { status: 201 }))
    const out = await createSystem({ name: 'h', hostname: '1.1.1.1' })
    expect(out).toEqual(created)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'h', hostname: '1.1.1.1' })
  })

  it('deleteSystem issues DELETE with encoded id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteSystem('a/b')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/a%2Fb')
    expect(init.method).toBe('DELETE')
  })

  it('throws ApiError with backend error message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'name is required' }, { status: 400 }))
    await expect(createSystem({ name: '', hostname: 'x' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'name is required',
    })
  })

  it('falls back to statusText when body has no error field', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
    )
    await expect(listSystems()).rejects.toBeInstanceOf(ApiError)
  })
})
