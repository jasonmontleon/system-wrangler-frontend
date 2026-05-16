// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptHostKey, deleteHostKey, listHostKeys, scanHostKeys } from './hostkeys'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('hostkeys api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listHostKeys unwraps the response array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hostKeys: [
          {
            id: 'k1',
            systemId: 's1',
            state: 'pending',
            algorithm: 'ssh-ed25519',
            publicKey: 'AAAA',
            fingerprint: 'SHA256:abc',
            firstSeenAt: '2026-05-15T00:00:00Z',
          },
        ],
      }),
    )
    const got = await listHostKeys('s1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/s1/host-keys')
    expect(got).toHaveLength(1)
    expect(got[0].fingerprint).toBe('SHA256:abc')
  })

  it('listHostKeys raises ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 500 }))
    await expect(listHostKeys('s1')).rejects.toBeInstanceOf(ApiError)
  })

  it('acceptHostKey posts the body and parses the response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'k1',
        systemId: 's1',
        state: 'accepted',
        algorithm: 'ssh-ed25519',
        publicKey: 'AAAA',
        fingerprint: 'SHA256:abc',
        firstSeenAt: '2026-05-15T00:00:00Z',
        acceptedAt: '2026-05-15T00:01:00Z',
      }),
    )
    const got = await acceptHostKey('s1', {
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/s1/host-keys/accept')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"algorithm":"ssh-ed25519","fingerprint":"SHA256:abc"}')
    expect(got.state).toBe('accepted')
  })

  it('acceptHostKey surfaces 409 as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'stale' }, { status: 409 }))
    await expect(
      acceptHostKey('s1', { algorithm: 'ssh-ed25519', fingerprint: 'x' }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('deleteHostKey sends DELETE and tolerates 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteHostKey('s1', 'k1')
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'none' }, { status: 404 }))
    await deleteHostKey('s1', 'gone')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/s1/host-keys/k1')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/systems/s1/host-keys/gone')
  })

  it('deleteHostKey raises on other errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(deleteHostKey('s1', 'k1')).rejects.toBeInstanceOf(ApiError)
  })

  it('scanHostKeys POSTs and unwraps the response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hostKeys: [
          {
            id: 'k1',
            systemId: 's1',
            state: 'pending',
            algorithm: 'ssh-ed25519',
            publicKey: 'AAAA',
            fingerprint: 'SHA256:abc',
            firstSeenAt: '2026-05-15T00:00:00Z',
          },
        ],
      }),
    )
    const got = await scanHostKeys('s1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/s1/host-keys/scan')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(got).toHaveLength(1)
    expect(got[0].fingerprint).toBe('SHA256:abc')
  })

  it('scanHostKeys raises ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 502 }))
    await expect(scanHostKeys('s1')).rejects.toBeInstanceOf(ApiError)
  })

  it('encodes ids that contain unsafe characters', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hostKeys: [] }))
    await listHostKeys('host/1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/host%2F1/host-keys')
  })
})
