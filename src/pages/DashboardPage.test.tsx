// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor, within } from '@testing-library/react'
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

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the empty state when no systems exist', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems') return Promise.resolve(jsonResponse([]))
      if (url.includes('/api/metrics/query_range?')) return Promise.resolve(emptyMatrix())
      if (url.includes('/api/metrics/query?')) return Promise.resolve(emptyVector())
      return Promise.resolve(jsonResponse({}, 500))
    })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No systems yet/i)).toBeInTheDocument()
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
      // rebootRequiredAt must win over a pending=0 "healthy" classification:
      sys({
        status: 'reachable',
        pendingUpdates: 0,
        rebootRequiredAt: '2026-05-28T14:30:00Z',
      }),
      sys({ status: 'unprobed' }), // unknown
    ]
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems') return Promise.resolve(jsonResponse(systems))
      if (url.includes('/api/metrics/query_range?')) return Promise.resolve(emptyMatrix())
      if (url.includes('/api/metrics/query?')) return Promise.resolve(emptyVector())
      return Promise.resolve(jsonResponse({}, 500))
    })
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

  it('surfaces a load error when /api/systems fails', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems')
        return Promise.resolve(jsonResponse({ error: 'down' }, 500))
      if (url.includes('/api/metrics/query_range?')) return Promise.resolve(emptyMatrix())
      if (url.includes('/api/metrics/query?')) return Promise.resolve(emptyVector())
      return Promise.resolve(jsonResponse({}, 500))
    })
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
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems') return Promise.resolve(jsonResponse(systems))
      if (url.includes('/api/metrics/query_range?')) return Promise.resolve(emptyMatrix())
      if (url.includes('/api/metrics/query?')) {
        if (url.includes('node_cpu_seconds_total')) {
          return Promise.resolve(
            metricVector({ 'sys-1': 90, 'sys-2': 15, 'sys-3': 99 }),
          )
        }
        if (
          url.includes('MemAvailable_bytes') &&
          !url.includes('node_network')
        ) {
          return Promise.resolve(metricVector({ 'sys-1': 80, 'sys-2': 20 }))
        }
        if (url.includes('node_filesystem_avail_bytes')) {
          return Promise.resolve(metricVector({ 'sys-1': 40, 'sys-2': 95 }))
        }
        if (url.includes('node_network_receive_bytes_total')) {
          return Promise.resolve(
            metricVector({ 'sys-1': 5_000_000, 'sys-2': 200 }),
          )
        }
        if (url.includes('node_disk_read_bytes_total')) {
          return Promise.resolve(
            metricVector({ 'sys-1': 10_000_000, 'sys-2': 500 }),
          )
        }
        return Promise.resolve(emptyVector())
      }
      return Promise.resolve(jsonResponse({}, 500))
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
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems') return Promise.resolve(jsonResponse(systems))
      if (url.includes('/api/metrics/query_range?')) return Promise.resolve(emptyMatrix())
      if (url.includes('/api/metrics/query?')) return Promise.resolve(emptyVector())
      return Promise.resolve(jsonResponse({}, 500))
    })
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

  it('renders the global trends section with time-series panels', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems') return Promise.resolve(jsonResponse([]))
      if (url.includes('/api/metrics/query_range?')) return Promise.resolve(emptyMatrix())
      if (url.includes('/api/metrics/query?')) return Promise.resolve(emptyVector())
      return Promise.resolve(jsonResponse({}, 500))
    })
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('heading', { name: /Global trends/i, level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('CPU busy (%)')).toBeInTheDocument()
    expect(screen.getByText('Memory used (%)')).toBeInTheDocument()
    expect(screen.getByText('Worst filesystem usage (%)')).toBeInTheDocument()
    expect(
      screen.getByText('Network IO (bytes/sec, all systems)'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Disk IO (bytes/sec, all systems)'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: /Time range presets/i }),
    ).toBeInTheDocument()
  })
})
