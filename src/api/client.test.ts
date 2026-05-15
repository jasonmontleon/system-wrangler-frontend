// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client'

describe('apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function headerOf(call: unknown[], key: string): string | null {
    const init = call[1] as RequestInit | undefined
    const headers = new Headers(init?.headers)
    return headers.get(key)
  }

  it('injects the CSRF header on a bare call', async () => {
    await apiFetch('/api/foo')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(headerOf(fetchMock.mock.calls[0], 'X-Sw-Csrf')).toBe('1')
  })

  it('merges with caller-supplied headers', async () => {
    await apiFetch('/api/foo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const call = fetchMock.mock.calls[0]
    expect(headerOf(call, 'X-Sw-Csrf')).toBe('1')
    expect(headerOf(call, 'Content-Type')).toBe('application/json')
    const init = call[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
  })

  it('overrides any caller-supplied CSRF header value', async () => {
    // Defense-in-depth: a stale or wrong value from a misbehaving
    // call site must not slip through.
    await apiFetch('/api/foo', {
      method: 'DELETE',
      headers: new Headers({ 'X-Sw-Csrf': 'bogus' }),
    })
    expect(headerOf(fetchMock.mock.calls[0], 'X-Sw-Csrf')).toBe('1')
  })

  it('accepts Headers / array / record init shapes', async () => {
    await apiFetch('/api/a', { headers: { Foo: 'bar' } })
    await apiFetch('/api/b', { headers: [['Foo', 'bar']] })
    await apiFetch('/api/c', { headers: new Headers({ Foo: 'bar' }) })
    for (const call of fetchMock.mock.calls) {
      expect(headerOf(call, 'X-Sw-Csrf')).toBe('1')
      expect(headerOf(call, 'Foo')).toBe('bar')
    }
  })
})
