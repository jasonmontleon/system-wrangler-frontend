// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage'
import type { System } from '../api/systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function metricVector(values: Record<string, number>): Response {
  return jsonResponse({
    status: 'success',
    data: {
      resultType: 'vector',
      result: Object.entries(values).map(([systemId, v]) => ({
        metric: { system_id: systemId },
        value: [1_716_000_000, String(v)],
      })),
    },
  })
}

const emptyVector = () =>
  jsonResponse({
    status: 'success',
    data: { resultType: 'vector', result: [] },
  })

const emptyMatrix = () =>
  jsonResponse({
    status: 'success',
    data: { resultType: 'matrix', result: [] },
  })

function sys(overrides: Partial<System>): System {
  return {
    id: 's-' + Math.random().toString(36).slice(2, 8),
    name: 'host',
    hostname: '10.0.0.1',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'reachable',
    ...overrides,
  }
}

class FakeEventSource {
  constructor(public url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

// allWidgetsLayout builds a server-side layout that enables every
// single-instance widget. Used by tests that pre-date the change
// shrinking the new-user default to just SH + Backend health; the
// rest of the original surface still needs to be exercised here.
function allWidgetsLayout() {
  return [
    { instanceId: 'system-health', widgetId: 'system-health', enabled: true },
    { instanceId: 'backend-health', widgetId: 'backend-health', enabled: true },
    { instanceId: 'busiest-cpu', widgetId: 'busiest-cpu', enabled: true },
    { instanceId: 'lowest-free-memory', widgetId: 'lowest-free-memory', enabled: true },
    { instanceId: 'lowest-free-disk', widgetId: 'lowest-free-disk', enabled: true },
    { instanceId: 'highest-network-io', widgetId: 'highest-network-io', enabled: true },
    { instanceId: 'highest-disk-io', widgetId: 'highest-disk-io', enabled: true },
    { instanceId: 'most-pending-updates', widgetId: 'most-pending-updates', enabled: true },
    { instanceId: 'global-cpu-trend', widgetId: 'global-cpu-trend', enabled: true },
    { instanceId: 'global-memory-trend', widgetId: 'global-memory-trend', enabled: true },
    { instanceId: 'global-fs-trend', widgetId: 'global-fs-trend', enabled: true },
    { instanceId: 'global-network-io-trend', widgetId: 'global-network-io-trend', enabled: true },
    { instanceId: 'global-disk-io-trend', widgetId: 'global-disk-io-trend', enabled: true },
  ]
}

// stubFetch wires a single fetch stub that handles every endpoint the
// dashboard touches. It exposes a `layoutStore` ref the test can read
// or seed to model server-side per-user persistence; PUTs to
// /api/dashboard/layout mutate it so the next GET reflects the change.
function stubFetch(opts: {
  systems?: System[]
  systemsStatus?: number
  metricVectorFor?: (urlPart: string) => Response | null
  layoutStore?: { value: unknown }
}) {
  const layoutStore = opts.layoutStore ?? { value: null }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/health') return jsonResponse({ status: 'ok' })
    if (url === '/api/ready')
      return jsonResponse({ status: 'ready', checks: { database: 'ok' } })
    if (url === '/api/systems') {
      if (opts.systemsStatus && opts.systemsStatus !== 200) {
        return jsonResponse({ error: 'down' }, opts.systemsStatus)
      }
      return jsonResponse(opts.systems ?? [])
    }
    if (url === '/api/dashboard/layout') {
      if ((init?.method ?? 'GET') === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { layout: unknown }
        layoutStore.value = body.layout
        return new Response(null, { status: 204 })
      }
      const payload = layoutStore.value === null ? {} : { layout: layoutStore.value }
      return jsonResponse(payload)
    }
    if (url.includes('/api/metrics/query_range?')) return emptyMatrix()
    if (url.includes('/api/metrics/query?')) {
      if (opts.metricVectorFor) {
        const r = opts.metricVectorFor(url)
        if (r) return r
      }
      return emptyVector()
    }
    return jsonResponse({}, 500)
  })
  return layoutStore
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('shows the empty state when no systems exist', async () => {
    stubFetch({ systems: [] })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No systems/i)).toBeInTheDocument()
  })

  it('tallies systems into the six health buckets with precedence', async () => {
    // Precedence rule from SystemStatusIcon:
    //   unreachable → red
    //   lastRunFailed → red (Failed run bucket)
    //   rebootRequiredAt set → orange (Reboot required)
    //   reachable + pending > 0 → yellow
    //   reachable + pending = 0 → green
    //   anything else (unprobed / never checked) → grey
    const systems: System[] = [
      sys({ status: 'reachable', pendingUpdates: 0 }), // healthy
      sys({ status: 'reachable', pendingUpdates: 0 }), // healthy
      sys({ status: 'reachable', pendingUpdates: 3 }), // updates available
      sys({ status: 'reachable', pendingUpdates: 7 }), // updates available
      sys({ status: 'reachable', pendingUpdates: 1 }), // updates available
      sys({ status: 'unreachable' }), // unreachable (precedence)
      // lastRunFailed must win over pending > 0:
      sys({ status: 'reachable', pendingUpdates: 5, lastRunFailed: true }),
      // rebootRequiredAt must win over a pending=0 "healthy" classification.
      // Fresh stamp so it sits inside the grace window the donut now
      // applies to the apply-stamped column.
      sys({
        status: 'reachable',
        pendingUpdates: 0,
        rebootRequiredAt: new Date().toISOString(),
      }),
      sys({ status: 'unprobed' }), // unknown
    ]
    stubFetch({ systems })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    // Wait for the donut to render — its center label carries the total.
    await screen.findByLabelText('Healthy count')
    expect(screen.getByLabelText('Healthy count').textContent).toBe('2')
    expect(screen.getByLabelText('Updates available count').textContent).toBe('3')
    expect(screen.getByLabelText('Reboot required count').textContent).toBe('1')
    expect(screen.getByLabelText('Unreachable count').textContent).toBe('1')
    expect(screen.getByLabelText('Failed run count').textContent).toBe('1')
    expect(screen.getByLabelText('Unknown count').textContent).toBe('1')
  })

  it('flips the backend-health card from ok to error when the polled fetch starts failing', async () => {
    // Layout pinned so the backend-health card is the only widget on
    // screen, otherwise the assertions race against the other widgets
    // making their own /api/systems / metrics calls.
    window.localStorage.setItem(
      'sw.dashboard.layout.v1',
      JSON.stringify([
        { instanceId: 'backend-health', widgetId: 'backend-health', enabled: true },
      ]),
    )
    let healthShouldFail = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') {
        if (healthShouldFail) return new Response('', { status: 500 })
        return jsonResponse({ status: 'ok' })
      }
      if (url === '/api/ready')
        return jsonResponse({ status: 'ready', checks: { database: 'ok' } })
      if (url === '/api/systems') return jsonResponse([])
      if (url === '/api/dashboard/layout') return jsonResponse({})
      if (url.includes('/api/metrics/query_range?')) return emptyMatrix()
      if (url.includes('/api/metrics/query?')) return emptyVector()
      return jsonResponse({}, 500)
    })

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>,
      )
      // First poll: card reports the live backend.
      expect(await screen.findByText(/status: ok/)).toBeInTheDocument()

      healthShouldFail = true
      // Advance past the 15 s poll interval.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_500)
      })

      await waitFor(() => {
        expect(screen.queryByText(/status: ok/)).toBeNull()
      })
      expect(screen.getByText(/error: HTTP 500/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces a load error when /api/systems fails', async () => {
    stubFetch({ systemsStatus: 500 })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/Could not load systems/i),
    ).toBeInTheDocument()
  })

  it('renders the six leaderboards with top entries ordered by descending value', async () => {
    const systems: System[] = [
      sys({ id: 'sys-1', name: 'web-1', status: 'reachable', pendingUpdates: 5 }),
      sys({ id: 'sys-2', name: 'db-1', status: 'reachable', pendingUpdates: 0 }),
      sys({ id: 'sys-3', name: 'offline-1', status: 'unreachable' }),
    ]
    stubFetch({
      systems,
      layoutStore: { value: allWidgetsLayout() },
      metricVectorFor: (url) => {
        if (url.includes('node_cpu_seconds_total')) {
          return metricVector({ 'sys-1': 90, 'sys-2': 15, 'sys-3': 99 })
        }
        if (url.includes('MemAvailable_bytes') && !url.includes('node_network')) {
          return metricVector({ 'sys-1': 80, 'sys-2': 20 })
        }
        if (url.includes('node_filesystem_avail_bytes')) {
          return metricVector({ 'sys-1': 40, 'sys-2': 95 })
        }
        if (url.includes('node_network_receive_bytes_total')) {
          return metricVector({ 'sys-1': 5_000_000, 'sys-2': 200 })
        }
        if (url.includes('node_disk_read_bytes_total')) {
          return metricVector({ 'sys-1': 10_000_000, 'sys-2': 500 })
        }
        return null
      },
    })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    const cpu = await screen.findByText('Busiest CPU')
    const cpuCard = cpu.closest('.pf-v6-c-card') as HTMLElement
    await waitFor(() => {
      const links = Array.from(cpuCard.querySelectorAll('a')).map(
        (a) => a.textContent,
      )
      // offline-1 is unreachable and must be excluded even though it has
      // the highest sample.
      expect(links).toEqual(['web-1', 'db-1'])
    })
    expect(within(cpuCard).getByText('90%')).toBeInTheDocument()

    const mem = screen.getByText('Lowest free memory')
    const memCard = mem.closest('.pf-v6-c-card') as HTMLElement
    expect(within(memCard).getByText('80%')).toBeInTheDocument()
    expect(within(memCard).getByText('20%')).toBeInTheDocument()

    const disk = screen.getByText('Lowest free disk')
    const diskCard = disk.closest('.pf-v6-c-card') as HTMLElement
    const diskLinks = Array.from(diskCard.querySelectorAll('a')).map(
      (a) => a.textContent,
    )
    expect(diskLinks[0]).toBe('db-1')

    const net = screen.getByText('Highest network IO')
    const netCard = net.closest('.pf-v6-c-card') as HTMLElement
    expect(within(netCard).getByText(/MB\/s/)).toBeInTheDocument()

    const diskIo = screen.getByText('Highest disk IO')
    const diskIoCard = diskIo.closest('.pf-v6-c-card') as HTMLElement
    expect(within(diskIoCard).getByText(/MB\/s/)).toBeInTheDocument()

    const pending = screen.getByText('Most pending updates')
    const pendingCard = pending.closest('.pf-v6-c-card') as HTMLElement
    const pendingLinks = Array.from(pendingCard.querySelectorAll('a')).map(
      (a) => a.textContent,
    )
    // db-1 has pendingUpdates=0 and should be filtered out.
    expect(pendingLinks).toEqual(['web-1'])
    expect(within(pendingCard).getByText('5')).toBeInTheDocument()
  })

  it('shows empty-state text on leaderboards when no metrics resolve', async () => {
    const systems: System[] = [
      sys({ id: 'sys-1', name: 'web-1', status: 'reachable', pendingUpdates: 0 }),
    ]
    stubFetch({ systems, layoutStore: { value: allWidgetsLayout() } })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/No CPU samples in the current window\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No memory samples in the current window\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No filesystem samples in the current window\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No network samples in the current window\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No disk samples in the current window\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No systems have pending updates\./i),
    ).toBeInTheDocument()
  })

  it('renders each global trend widget with its own time-range picker', async () => {
    stubFetch({ systems: [], layoutStore: { value: allWidgetsLayout() } })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('CPU busy (%)')).toBeInTheDocument()
    expect(screen.getByText('Memory used (%)')).toBeInTheDocument()
    expect(screen.getByText('Worst filesystem usage (%)')).toBeInTheDocument()
    expect(screen.getByText('Network IO (bytes/sec)')).toBeInTheDocument()
    expect(screen.getByText('Disk IO (bytes/sec)')).toBeInTheDocument()
    // One picker per trend widget — five trends defaults on.
    expect(
      screen.getAllByRole('group', { name: /Time range presets/i }),
    ).toHaveLength(5)
  })

  it('opens the customize modal and toggling a widget off hides it', async () => {
    stubFetch({ systems: [], layoutStore: { value: allWidgetsLayout() } })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    await screen.findByText('Busiest CPU')
    fireEvent.click(
      screen.getByRole('button', { name: /Customize dashboard/i }),
    )
    const checkbox = await screen.findByRole('checkbox', {
      name: /Show Busiest CPU/i,
    })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => {
      expect(screen.queryByText('Busiest CPU')).not.toBeInTheDocument()
    })
  })

  it('reset restores hidden widgets from inside the modal', async () => {
    stubFetch({
      systems: [],
      // Seed with all widgets visible (matches the legacy default
      // layout). One row (busiest-cpu) is disabled so we can verify
      // Reset re-enables it. After reset, the layout falls back to the
      // brand-new-user shape (system-health + backend-health only), so
      // we assert visibility of system-health instead of busiest-cpu.
      layoutStore: {
        value: allWidgetsLayout().map((e) =>
          e.widgetId === 'busiest-cpu' ? { ...e, enabled: false } : e,
        ),
      },
    })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(screen.queryByText('Busiest CPU')).not.toBeInTheDocument()
    })
    fireEvent.click(
      screen.getByRole('button', { name: /Customize dashboard/i }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: /Reset to defaults/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    // After Reset → Apply the layout falls back to the brand-new-user
    // shape: system-health + backend-health only. Verify those are
    // present and the previously-disabled busiest-cpu is gone (it's
    // not in the default-enabled set anymore).
    await waitFor(() => {
      expect(screen.getByText('System health')).toBeInTheDocument()
      expect(screen.getByText('Backend health')).toBeInTheDocument()
    })
    expect(screen.queryByText('Busiest CPU')).not.toBeInTheDocument()
  })

  it('persists layout changes to the server across mounts', async () => {
    const layoutStore = stubFetch({ systems: [] })
    const { unmount } = render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    await screen.findByText('Backend health')
    fireEvent.click(
      screen.getByRole('button', { name: /Customize dashboard/i }),
    )
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Show Backend health/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => {
      expect(screen.queryByText('Backend health')).not.toBeInTheDocument()
    })
    // The hook debounces the PUT — wait for the saved state to update.
    await waitFor(() => {
      expect(layoutStore.value).not.toBeNull()
    })
    unmount()
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    // System health is still default-enabled; Backend health stays
    // hidden because the persisted layout disabled it.
    await screen.findByText('System health')
    expect(screen.queryByText('Backend health')).not.toBeInTheDocument()
  })
})
