// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGlobalExclusion,
  createGroupExclusion,
  createSystemExclusion,
  deleteGlobalExclusion,
  deleteGroupExclusion,
  deleteSystemExclusion,
  listEffectiveSystemExclusions,
  listGlobalExclusions,
  listGroupExclusions,
  listSystemExclusions,
} from './exclusions'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('exclusions api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listGlobalExclusions hits the admin endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    const rows = await listGlobalExclusions()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/package-exclusions')
    expect(rows).toEqual([])
  })

  it('listGlobalExclusions surfaces 500 as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'boom' }, { status: 500 }),
    )
    await expect(listGlobalExclusions()).rejects.toBeInstanceOf(ApiError)
  })

  it('createGlobalExclusion posts JSON to admin endpoint', async () => {
    const row = {
      id: 'e1',
      scope: 'global' as const,
      updater: 'builtin.dnf',
      pattern: 'kernel*',
      createdAt: 't',
      createdBy: 'u',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(row, { status: 201 }))
    const got = await createGlobalExclusion({
      updater: 'builtin.dnf',
      pattern: 'kernel*',
    })
    expect(got).toEqual(row)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/package-exclusions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      updater: 'builtin.dnf',
      pattern: 'kernel*',
    })
  })

  it('createGlobalExclusion surfaces 409 conflicts', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'dup' }, { status: 409 }),
    )
    await expect(
      createGlobalExclusion({ updater: 'builtin.dnf', pattern: 'k' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('deleteGlobalExclusion DELETEs the id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteGlobalExclusion('e1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/package-exclusions/e1')
    expect(init.method).toBe('DELETE')
  })

  it('group endpoints carry the group id in the path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listGroupExclusions('g1')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/groups/g1/package-exclusions',
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          id: 'e1',
          scope: 'group',
          targetId: 'g1',
          updater: 'builtin.dnf',
          pattern: 'nginx',
          createdAt: 't',
          createdBy: 'u',
        },
        { status: 201 },
      ),
    )
    await createGroupExclusion('g1', { updater: 'builtin.dnf', pattern: 'nginx' })
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/groups/g1/package-exclusions',
    )
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteGroupExclusion('g1', 'e1')
    expect(fetchMock.mock.calls[2][0]).toBe(
      '/api/groups/g1/package-exclusions/e1',
    )
  })

  it('system endpoints carry the system id in the path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listSystemExclusions('s1')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/systems/s1/package-exclusions',
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          id: 'e1',
          scope: 'system',
          targetId: 's1',
          updater: 'builtin.dnf',
          pattern: 'redis',
          createdAt: 't',
          createdBy: 'u',
        },
        { status: 201 },
      ),
    )
    await createSystemExclusion('s1', {
      updater: 'builtin.dnf',
      pattern: 'redis',
    })
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/systems/s1/package-exclusions',
    )
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteSystemExclusion('s1', 'e1')
    expect(fetchMock.mock.calls[2][0]).toBe(
      '/api/systems/s1/package-exclusions/e1',
    )
  })

  it('listEffectiveSystemExclusions appends the updater query param', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listEffectiveSystemExclusions('s1', 'builtin.dnf')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/systems/s1/package-exclusions/effective?updater=builtin.dnf',
    )
  })

  it('encodes path segments to handle slashes and special chars', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteSystemExclusion('s/1', 'e?1')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/systems/s%2F1/package-exclusions/e%3F1',
    )
  })
})
