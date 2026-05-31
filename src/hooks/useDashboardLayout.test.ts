// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LAYOUT_STORAGE_KEY,
  appendInstance,
  moveEntry,
  reconcileLayout,
  removeEntry,
  reorder,
  setEntryEnabled,
  useDashboardLayout,
  type LayoutEntry,
} from './useDashboardLayout'
import { WIDGETS } from '../dashboard/widgets'

const SINGLE_INSTANCE_IDS = WIDGETS.filter((w) => !w.templated).map((w) => w.id)
const DEFAULT_LAYOUT_IDS = WIDGETS.filter((w) => w.defaultEnabled).map(
  (w) => w.id,
)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('reconcileLayout', () => {
  it('returns defaults when given a non-array', () => {
    const out = reconcileLayout(null)
    expect(out.map((e) => e.widgetId)).toEqual(DEFAULT_LAYOUT_IDS)
    for (const e of out) expect(e.enabled).toBe(true)
  })

  it('migrates v1 {id, enabled} entries into instanceId/widgetId shape', () => {
    const out = reconcileLayout([{ id: 'busiest-cpu', enabled: false }])
    expect(out[0]).toEqual({
      instanceId: 'busiest-cpu',
      widgetId: 'busiest-cpu',
      enabled: false,
    })
  })

  it('migrates v2 entries that still carry a size key', () => {
    const out = reconcileLayout([
      { id: 'busiest-cpu', enabled: false, size: 'L' },
    ])
    expect(out[0]).toEqual({
      instanceId: 'busiest-cpu',
      widgetId: 'busiest-cpu',
      enabled: false,
    })
  })

  it('round-trips v3 {instanceId, widgetId, enabled, params} entries', () => {
    const out = reconcileLayout([
      {
        instanceId: 'abc',
        widgetId: 'group-busiest-cpu',
        enabled: true,
        params: { groupId: 'g1' },
      },
    ])
    expect(out[0]).toEqual({
      instanceId: 'abc',
      widgetId: 'group-busiest-cpu',
      enabled: true,
      params: { groupId: 'g1' },
    })
  })

  it('drops unknown widget ids', () => {
    const out = reconcileLayout([
      { instanceId: 'x', widgetId: 'not-a-widget', enabled: true },
      { instanceId: 'busiest-cpu', widgetId: 'busiest-cpu', enabled: false },
    ])
    expect(out.find((e) => e.widgetId === ('not-a-widget' as never))).toBeUndefined()
    expect(out.find((e) => e.widgetId === 'busiest-cpu')?.enabled).toBe(false)
  })

  it('de-duplicates repeated singleton widgetIds', () => {
    const out = reconcileLayout([
      { id: 'busiest-cpu', enabled: false },
      { id: 'busiest-cpu', enabled: true },
    ])
    expect(out.filter((e) => e.widgetId === 'busiest-cpu')).toHaveLength(1)
    expect(out[0].enabled).toBe(false)
  })

  it('allows multiple instances of templated widgets with distinct instance ids', () => {
    const out = reconcileLayout([
      {
        instanceId: 'a',
        widgetId: 'group-busiest-cpu',
        enabled: true,
        params: { groupId: 'g1' },
      },
      {
        instanceId: 'b',
        widgetId: 'group-busiest-cpu',
        enabled: true,
        params: { groupId: 'g2' },
      },
    ])
    expect(out.filter((e) => e.widgetId === 'group-busiest-cpu')).toHaveLength(2)
  })

  it('appends missing singleton widgets at the end with defaults', () => {
    const out = reconcileLayout([{ id: 'busiest-cpu', enabled: false }])
    expect(out[0].widgetId).toBe('busiest-cpu')
    const appended = out.slice(1).map((e) => e.widgetId)
    expect(appended).toEqual(
      SINGLE_INSTANCE_IDS.filter((id) => id !== 'busiest-cpu'),
    )
  })
})

describe('moveEntry / setEntryEnabled / removeEntry / appendInstance', () => {
  const base: LayoutEntry[] = [
    { instanceId: 'busiest-cpu', widgetId: 'busiest-cpu', enabled: true },
    {
      instanceId: 'lowest-free-memory',
      widgetId: 'lowest-free-memory',
      enabled: true,
    },
    {
      instanceId: 'lowest-free-disk',
      widgetId: 'lowest-free-disk',
      enabled: true,
    },
  ]

  it('moves an entry down', () => {
    const out = moveEntry(base, 0, 1)
    expect(out.map((e) => e.widgetId)).toEqual([
      'lowest-free-memory',
      'busiest-cpu',
      'lowest-free-disk',
    ])
  })

  it('returns the original array if the target is out of bounds', () => {
    expect(moveEntry(base, 0, -1)).toBe(base)
    expect(moveEntry(base, 2, 1)).toBe(base)
    expect(moveEntry(base, -1, 1)).toBe(base)
    expect(moveEntry(base, 5, -1)).toBe(base)
  })

  it('toggles enabled by instanceId', () => {
    const out = setEntryEnabled(base, 'busiest-cpu', false)
    expect(out[0].enabled).toBe(false)
    expect(out[1].enabled).toBe(true)
  })

  it('removes by instanceId', () => {
    const out = removeEntry(base, 'busiest-cpu')
    expect(out.map((e) => e.widgetId)).toEqual([
      'lowest-free-memory',
      'lowest-free-disk',
    ])
  })

  it('reorder moves an entry from one absolute index to another', () => {
    const out = reorder(base, 0, 3)
    expect(out.map((e) => e.widgetId)).toEqual([
      'lowest-free-memory',
      'lowest-free-disk',
      'busiest-cpu',
    ])
  })

  it('reorder is a no-op when source and target slot are identical', () => {
    expect(reorder(base, 1, 1)).toBe(base)
    expect(reorder(base, 1, 2)).toBe(base) // dropping just below self
  })

  it('reorder clamps out-of-range moves to a no-op', () => {
    expect(reorder(base, -1, 0)).toBe(base)
    expect(reorder(base, 0, 99)).toBe(base)
  })

  it('appendInstance pushes a new entry with a generated id', () => {
    const out = appendInstance(base, 'group-busiest-cpu', { groupId: 'g1' })
    expect(out).toHaveLength(base.length + 1)
    const last = out[out.length - 1]
    expect(last.widgetId).toBe('group-busiest-cpu')
    expect(last.params).toEqual({ groupId: 'g1' })
    expect(last.enabled).toBe(true)
    expect(typeof last.instanceId).toBe('string')
    expect(last.instanceId.length).toBeGreaterThan(0)
  })
})

describe('useDashboardLayout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('starts in loading and hydrates from the server', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        layout: [{ instanceId: 'busiest-cpu', widgetId: 'busiest-cpu', enabled: false }],
      }),
    )
    const { result } = renderHook(() => useDashboardLayout())
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.layout[0]).toMatchObject({
      widgetId: 'busiest-cpu',
      enabled: false,
    })
  })

  it('uses defaults when the server returns an empty body', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchSpy.mockResolvedValueOnce(jsonResponse({}))
    const { result } = renderHook(() => useDashboardLayout())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.layout.map((e) => e.widgetId)).toEqual(DEFAULT_LAYOUT_IDS)
  })

  it('PUTs (debounced) when the layout changes', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchSpy.mockResolvedValueOnce(jsonResponse({}))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { result } = renderHook(() => useDashboardLayout())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => {
      result.current.setLayout([
        { instanceId: 'busiest-cpu', widgetId: 'busiest-cpu', enabled: false },
      ])
    })
    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(putCalls).toHaveLength(1)
    })
  })

  it('migrates a legacy v1 localStorage layout to the server on first load', async () => {
    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify([{ id: 'backend-health', enabled: false }]),
    )
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchSpy.mockResolvedValueOnce(jsonResponse({}))
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { result } = renderHook(() => useDashboardLayout())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.layout[0]).toMatchObject({
      widgetId: 'backend-health',
      enabled: false,
    })
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull()
  })

  it('survives a failed server fetch by surfacing status=error', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchSpy.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useDashboardLayout())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.layout.map((e) => e.widgetId)).toEqual(DEFAULT_LAYOUT_IDS)
  })

  it('reset() restores defaults and schedules a save', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        layout: [{ instanceId: 'busiest-cpu', widgetId: 'busiest-cpu', enabled: false }],
      }),
    )
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { result } = renderHook(() => useDashboardLayout())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => {
      result.current.reset()
    })
    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(putCalls).toHaveLength(1)
    })
    const putCalls = fetchSpy.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
    )
    const body = JSON.parse(putCalls[0][1].body as string)
    expect((body.layout as LayoutEntry[]).map((e) => e.widgetId)).toEqual(
      DEFAULT_LAYOUT_IDS,
    )
  })
})
