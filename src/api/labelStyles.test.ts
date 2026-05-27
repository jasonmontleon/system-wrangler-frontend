// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteLabelStyle,
  listLabelStyles,
  setLabelStyle,
} from './labelStyles'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('labelStyles api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listLabelStyles GETs /api/label-styles and returns the map', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ env: 'blue', oncall: 'red' }))
    const got = await listLabelStyles()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/label-styles')
    expect(got).toEqual({ env: 'blue', oncall: 'red' })
  })

  it('listLabelStyles surfaces non-2xx as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 500 }))
    await expect(listLabelStyles()).rejects.toBeInstanceOf(ApiError)
  })

  it('setLabelStyle PUTs the color and returns the row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'env', color: 'blue' }),
    )
    const out = await setLabelStyle('env', 'blue')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/label-styles/env')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ color: 'blue' })
    expect(out).toEqual({ key: 'env', color: 'blue' })
  })

  it('setLabelStyle url-encodes the key (covers prefixed keys)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'example.com/role', color: 'teal' }),
    )
    await setLabelStyle('example.com/role', 'teal')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/label-styles/example.com%2Frole',
    )
  })

  it('setLabelStyle surfaces 403 forbidden as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))
    await expect(setLabelStyle('env', 'blue')).rejects.toMatchObject({ status: 403 })
  })

  it('deleteLabelStyle DELETEs the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteLabelStyle('env')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/label-styles/env')
    expect(init.method).toBe('DELETE')
  })

  it('deleteLabelStyle surfaces 404 as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { status: 404 }))
    await expect(deleteLabelStyle('missing')).rejects.toBeInstanceOf(ApiError)
  })

  it('parseError falls back to statusText with no body', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 502, statusText: 'Bad Gateway' }),
    )
    await expect(listLabelStyles()).rejects.toMatchObject({ message: 'Bad Gateway' })
  })
})
