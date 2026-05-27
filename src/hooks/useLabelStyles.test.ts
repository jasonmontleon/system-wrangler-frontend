// SPDX-License-Identifier: Apache-2.0

import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLabelStyles } from './useLabelStyles'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== fn)
  }
  close() {
    this.closed = true
  }
  emit(type: string, data: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data) })
    ;(this.listeners[type] ?? []).forEach((fn) => fn(e))
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('useLabelStyles', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches /api/label-styles on mount and exposes the map', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ env: 'blue' }))
    const { result } = renderHook(() => useLabelStyles())
    await waitFor(() => expect(result.current.styles.env).toBe('blue'))
    expect(result.current.error).toBeNull()
  })

  it('surfaces fetch failures without clobbering the (empty) map', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { result } = renderHook(() => useLabelStyles())
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.styles).toEqual({})
  })

  it('refetches on a debounced systems.changed SSE event', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ env: 'green' }))

    const { result } = renderHook(() => useLabelStyles())
    await waitFor(() => expect(result.current.styles).toEqual({}))

    act(() => {
      FakeEventSource.instances[0].emit('message', { type: 'systems.changed' })
    })
    await waitFor(() => expect(result.current.styles.env).toBe('green'))
  })

  it('ignores SSE events of other types', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    renderHook(() => useLabelStyles())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const before = fetchMock.mock.calls.length

    act(() => {
      FakeEventSource.instances[0].emit('message', { type: 'something-else' })
    })
    await new Promise((r) => setTimeout(r, 250))
    expect(fetchMock.mock.calls.length).toBe(before)
  })
})
