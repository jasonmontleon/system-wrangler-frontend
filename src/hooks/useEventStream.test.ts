// SPDX-License-Identifier: Apache-2.0

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEventStream, type ServerEvent } from './useEventStream'

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

describe('useEventStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens /api/events on mount', () => {
    renderHook(() => useEventStream(() => {}))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/events')
  })

  it('forwards parsed events to the latest callback', () => {
    const calls: ServerEvent[] = []
    const { rerender } = renderHook(
      ({ cb }) => useEventStream(cb),
      { initialProps: { cb: (e: ServerEvent) => calls.push({ ...e, type: 'first:' + e.type }) } },
    )

    FakeEventSource.instances[0].emit('message', { type: 'systems.changed' })
    expect(calls).toEqual([{ type: 'first:systems.changed' }])

    // Swap the callback. The same EventSource must keep streaming to the new fn.
    rerender({ cb: (e: ServerEvent) => calls.push({ ...e, type: 'second:' + e.type }) })
    FakeEventSource.instances[0].emit('message', { type: 'systems.changed' })

    expect(calls).toEqual([
      { type: 'first:systems.changed' },
      { type: 'second:systems.changed' },
    ])
    // Connection was not reopened.
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useEventStream(() => {}))
    expect(FakeEventSource.instances[0].closed).toBe(false)
    unmount()
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('ignores malformed payloads', () => {
    const calls: ServerEvent[] = []
    renderHook(() => useEventStream((e) => calls.push(e)))
    const es = FakeEventSource.instances[0]
    // Hand-craft a malformed message: emit() always JSON-encodes, so dispatch directly.
    const handler = (es as unknown as { listeners: Record<string, ((e: MessageEvent) => void)[]> })
      .listeners['message'][0]
    handler(new MessageEvent('message', { data: 'not json' }))
    expect(calls).toEqual([])
  })
})
