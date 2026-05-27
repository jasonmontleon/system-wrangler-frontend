// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSystemLabel,
  listLabelSummary,
  listSystemLabels,
  setSystemLabel,
} from './labels'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('labels api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listLabelSummary hits /api/labels and decodes the array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { key: 'env', count: 2, values: [{ value: 'prod', count: 2 }] },
        { key: 'oncall', count: 1, values: [{ value: null, count: 1 }] },
      ]),
    )
    const out = await listLabelSummary()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/labels')
    expect(out).toHaveLength(2)
    expect(out[1].values[0].value).toBeNull()
  })

  it('listLabelSummary raises ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, { status: 500 }))
    await expect(listLabelSummary()).rejects.toBeInstanceOf(ApiError)
  })

  it('listSystemLabels GETs the per-system endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ key: 'env', value: 'prod' }]),
    )
    const out = await listSystemLabels('sys-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/sys-1/labels')
    expect(out[0]).toEqual({ key: 'env', value: 'prod' })
  })

  it('listSystemLabels url-encodes the system id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listSystemLabels('weird id/with slash')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/systems/weird%20id%2Fwith%20slash/labels',
    )
  })

  it('setSystemLabel PUTs with body and returns the row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'env', value: 'prod' }),
    )
    const out = await setSystemLabel('sys-1', 'env', 'prod')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/sys-1/labels/env')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ value: 'prod' })
    expect(out).toEqual({ key: 'env', value: 'prod' })
  })

  it('setSystemLabel serializes null for bare tag', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'oncall', value: null }),
    )
    await setSystemLabel('sys-1', 'oncall', null)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ value: null })
  })

  it('setSystemLabel url-encodes the key (covers prefixed keys)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'example.com/role', value: 'db' }),
    )
    await setSystemLabel('sys-1', 'example.com/role', 'db')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/sys-1/labels/example.com%2Frole')
  })

  it('setSystemLabel surfaces 403 (reserved prefix) as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'reserved' }, { status: 403 }),
    )
    await expect(
      setSystemLabel('sys-1', 'system-wrangler.io/x', 'y'),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('setSystemLabel surfaces 400 (invalid) as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid label' }, { status: 400 }),
    )
    await expect(setSystemLabel('sys-1', 'bad key', 'x')).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  it('deleteSystemLabel DELETEs the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteSystemLabel('sys-1', 'env')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/sys-1/labels/env')
    expect(init.method).toBe('DELETE')
  })

  it('deleteSystemLabel surfaces 404 as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'not found' }, { status: 404 }),
    )
    await expect(deleteSystemLabel('sys-1', 'missing')).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  it('parseError falls back to statusText when body has no error key', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 502, statusText: 'Bad Gateway' }),
    )
    await expect(listLabelSummary()).rejects.toMatchObject({
      message: 'Bad Gateway',
    })
  })
})
