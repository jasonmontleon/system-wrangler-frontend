// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchMyScope,
  grantAdminRole,
  grantGroupRole,
  listAdminRoleAssignments,
  listGroupRoleAssignments,
  revokeAdminRole,
  revokeGroupRole,
} from './roles'
import { ApiError } from './systems'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('roles api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) =>
      (fetchMock as unknown as typeof fetch)(input, init),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchMyScope parses the response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ global: 'admin', groups: { 'g-1': 'operator' } }),
    )
    const scope = await fetchMyScope()
    expect(scope.global).toBe('admin')
    expect(scope.groups['g-1']).toBe('operator')
  })

  it('fetchMyScope defaults missing fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const scope = await fetchMyScope()
    expect(scope.global).toBe('')
    expect(scope.groups).toEqual({})
  })

  it('fetchMyScope wraps a 500 in ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    await expect(fetchMyScope()).rejects.toBeInstanceOf(ApiError)
  })

  it('listGroupRoleAssignments unwraps the envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ assignments: [{ userId: 'u', username: 'a', groupId: 'g', role: 'admin' }] }),
    )
    const rows = await listGroupRoleAssignments('g')
    expect(rows).toHaveLength(1)
    expect(rows[0].username).toBe('a')
  })

  it('grantGroupRole POSTs JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ userId: 'u', username: 'a', groupId: 'g', role: 'operator' }, 201),
    )
    await grantGroupRole('g', 'u', 'operator')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ userId: 'u', role: 'operator' }))
  })

  it('revokeGroupRole DELETEs the right path', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await revokeGroupRole('g', 'u', 'auditor')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/groups/g/role-assignments/u/auditor')
    expect(init.method).toBe('DELETE')
  })

  it('listAdminRoleAssignments unwraps the envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ assignments: [{ userId: 'u', username: 'a', groupId: null, role: 'admin' }] }),
    )
    const rows = await listAdminRoleAssignments()
    expect(rows).toHaveLength(1)
    expect(rows[0].groupId).toBeNull()
  })

  it('grantAdminRole accepts null groupId for global', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ userId: 'u', username: 'a', groupId: null, role: 'auditor' }, 201),
    )
    await grantAdminRole('u', null, 'auditor')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.body).toBe(JSON.stringify({ userId: 'u', groupId: null, role: 'auditor' }))
  })

  it('revokeAdminRole sends the body via DELETE', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await revokeAdminRole('u', 'g', 'operator')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(init.body).toBe(JSON.stringify({ userId: 'u', groupId: 'g', role: 'operator' }))
  })

  it('grant errors surface as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    await expect(grantGroupRole('g', 'u', 'admin')).rejects.toBeInstanceOf(ApiError)
  })
})
