// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteGlobalSlot,
  deleteGroupSlot,
  deleteSystemSlot,
  getEffectiveCredential,
  getGlobalSlot,
  getGroupSlot,
  getSystemSlot,
  listSlots,
  putGlobalSlot,
  putGroupSlot,
  putSystemSlot,
} from './credentials'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('credentials api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listSlots returns the unwrapped array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        slots: [
          { scopeKind: 'global', createdAt: 't', updatedAt: 't', ansibleUser: 'u' },
        ],
      }),
    )
    const got = await listSlots()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ansible-credentials')
    expect(got).toHaveLength(1)
    expect(got[0].scopeKind).toBe('global')
  })

  it('listSlots raises ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 500 }))
    await expect(listSlots()).rejects.toBeInstanceOf(ApiError)
  })

  it('getGlobalSlot returns null on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'none' }, { status: 404 }))
    expect(await getGlobalSlot()).toBeNull()
  })

  it('getGlobalSlot raises ApiError on other failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(getGlobalSlot()).rejects.toBeInstanceOf(ApiError)
  })

  it('putGlobalSlot sends PUT with body and parses the response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ scopeKind: 'global', createdAt: 't', updatedAt: 't', ansibleUser: 'u' }),
    )
    const got = await putGlobalSlot({ ansibleUser: 'u' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/ansible-credentials/global')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('PUT')
    expect(init.body).toBe('{"ansibleUser":"u"}')
    expect(got.ansibleUser).toBe('u')
  })

  it('putGlobalSlot raises ApiError on a 400', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, { status: 400 }))
    await expect(putGlobalSlot({ ansibleUser: 'u' })).rejects.toBeInstanceOf(ApiError)
  })

  it('deleteGlobalSlot swallows 404 (idempotent semantics)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'none' }, { status: 404 }))
    await deleteGlobalSlot()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('DELETE')
  })

  it('deleteGlobalSlot raises on other errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(deleteGlobalSlot()).rejects.toBeInstanceOf(ApiError)
  })

  it('group/system slot routes encode the id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ scopeKind: 'group', scopeId: 'g/1', createdAt: 't', updatedAt: 't' }),
    )
    await getGroupSlot('g/1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/groups/g%2F1/ansible-credential')

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ scopeKind: 'system', scopeId: 'h 1', createdAt: 't', updatedAt: 't' }),
    )
    await getSystemSlot('h 1')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/systems/h%201/ansible-credential')
  })

  it('putGroupSlot and putSystemSlot hit the matching paths', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ scopeKind: 'group', scopeId: 'g', createdAt: 't', updatedAt: 't' }),
    )
    await putGroupSlot('g', { ansibleUser: 'u' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/groups/g/ansible-credential')

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ scopeKind: 'system', scopeId: 's', createdAt: 't', updatedAt: 't' }),
    )
    await putSystemSlot('s', { clearKey: true })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/systems/s/ansible-credential')
  })

  it('delete group/system slots send DELETE', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteGroupSlot('g')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteSystemSlot('s')
    const a = fetchMock.mock.calls[0][1] as RequestInit
    const b = fetchMock.mock.calls[1][1] as RequestInit
    expect(a.method).toBe('DELETE')
    expect(b.method).toBe('DELETE')
  })

  it('getEffectiveCredential returns null on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'none' }, { status: 404 }))
    expect(await getEffectiveCredential('h-1')).toBeNull()
  })

  it('getEffectiveCredential returns body on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ansibleUser: 'u',
        userSource: 'global',
        publicKey: 'ssh-ed25519 AAAA',
        keySource: 'global',
        keyOrigin: 'sw_generated',
      }),
    )
    const got = await getEffectiveCredential('h-1')
    expect(got?.ansibleUser).toBe('u')
    expect(got?.keyOrigin).toBe('sw_generated')
  })

  it('getEffectiveCredential raises on 409', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'incomplete' }, { status: 409 }))
    await expect(getEffectiveCredential('h-1')).rejects.toBeInstanceOf(ApiError)
  })
})
