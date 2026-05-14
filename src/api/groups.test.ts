// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGroup,
  deleteGroup,
  listGroups,
  renameGroup,
  setSystemGroup,
} from './groups'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('groups api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listGroups hits /api/groups and returns the array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 'g', name: 'prod', createdAt: 't', systemCount: 0 }]),
    )
    const groups = await listGroups()
    expect(fetchMock).toHaveBeenCalledWith('/api/groups')
    expect(groups[0].name).toBe('prod')
  })

  it('listGroups raises ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 500 }))
    await expect(listGroups()).rejects.toBeInstanceOf(ApiError)
  })

  it('createGroup posts JSON', async () => {
    const created = { id: 'g', name: 'p', createdAt: 't', systemCount: 0 }
    fetchMock.mockResolvedValueOnce(jsonResponse(created, { status: 201 }))
    const out = await createGroup({ name: 'p' })
    expect(out).toEqual(created)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/groups')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'p' })
  })

  it('createGroup surfaces conflict as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'group name already exists' }, { status: 409 }),
    )
    await expect(createGroup({ name: 'dupe' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('renameGroup PATCHes the id', async () => {
    const renamed = { id: 'g', name: 'new', createdAt: 't', systemCount: 0 }
    fetchMock.mockResolvedValueOnce(jsonResponse(renamed))
    const out = await renameGroup('g', { name: 'new' })
    expect(out).toEqual(renamed)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/groups/g')
    expect(init.method).toBe('PATCH')
  })

  it('deleteGroup DELETEs the id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteGroup('g')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/groups/g')
    expect(init.method).toBe('DELETE')
  })

  it('deleteGroup surfaces 404 as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { status: 404 }))
    await expect(deleteGroup('missing')).rejects.toBeInstanceOf(ApiError)
  })

  it('setSystemGroup PUTs to /api/systems/{id}/group with groupId', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await setSystemGroup('sys-1', 'g-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/sys-1/group')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ groupId: 'g-1' })
  })

  it('setSystemGroup serializes a null clear', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await setSystemGroup('sys-1', null)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ groupId: null })
  })

  it('setSystemGroup surfaces server errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 500 }))
    await expect(setSystemGroup('s', 'g')).rejects.toBeInstanceOf(ApiError)
  })
})
