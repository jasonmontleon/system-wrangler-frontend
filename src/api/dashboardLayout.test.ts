// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDashboardLayout,
  saveDashboardLayout,
} from './dashboardLayout'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('dashboardLayout API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when the server has no saved layout', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({}),
    )
    expect(await fetchDashboardLayout()).toBeNull()
  })

  it('returns the saved layout when present', async () => {
    const payload = [{ id: 'system-health', enabled: true }]
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ layout: payload }),
    )
    expect(await fetchDashboardLayout()).toEqual(payload)
  })

  it('throws on non-200 fetch', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: 'down' }, 500),
    )
    await expect(fetchDashboardLayout()).rejects.toThrow(/HTTP 500/)
  })

  it('PUTs the layout wrapped in {layout}', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await saveDashboardLayout([{ id: 'busiest-cpu', enabled: false }])
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/dashboard/layout')
    expect(init.method).toBe('PUT')
    const headers = init.headers as Headers
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      layout: [{ id: 'busiest-cpu', enabled: false }],
    })
  })

  it('throws on non-2xx PUT', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: 'boom' }, 500),
    )
    await expect(saveDashboardLayout([])).rejects.toThrow(/HTTP 500/)
  })
})
