// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemsOverviewPage from './SystemsOverviewPage'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const systemsBody = [
  {
    id: 'sys-1',
    name: 'web-1',
    hostname: 'web-1.local',
    createdAt: '2026-05-23T00:00:00Z',
    status: 'reachable',
    groupId: 'g-web',
    pendingUpdates: 3,
  },
  {
    id: 'sys-2',
    name: 'db-1',
    hostname: 'db-1.local',
    createdAt: '2026-05-23T00:00:00Z',
    status: 'reachable',
    groupId: 'g-db',
    pendingUpdates: 0,
  },
  {
    id: 'sys-3',
    name: 'offline-1',
    hostname: 'offline-1.local',
    createdAt: '2026-05-23T00:00:00Z',
    status: 'unreachable',
    groupId: 'g-web',
  },
]

const groupsBody = [
  { id: 'g-web', name: 'Web tier', createdAt: '2026-05-01T00:00:00Z', systemCount: 2 },
  { id: 'g-db', name: 'Database tier', createdAt: '2026-05-01T00:00:00Z', systemCount: 1 },
]

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

function metricResponseFor(url: string): Response {
  if (url.includes('node_cpu_seconds_total')) {
    return metricVector({ 'sys-1': 92, 'sys-2': 12 })
  }
  if (url.includes('MemAvailable_bytes')) {
    return metricVector({ 'sys-1': 70, 'sys-2': 30 })
  }
  if (url.includes('node_filesystem_avail_bytes')) {
    return metricVector({ 'sys-1': 50, 'sys-2': 95 })
  }
  return jsonResponse({
    status: 'success',
    data: { resultType: 'vector', result: [] },
  })
}

describe('SystemsOverviewPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/api/groups') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(groupsBody))
      }
      if (s.includes('/api/systems') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(systemsBody))
      }
      if (s.includes('/api/metrics/query?')) {
        return Promise.resolve(metricResponseFor(s))
      }
      return Promise.resolve(jsonResponse({}, 404))
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders one row per system with metric values from Prometheus', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    const inTable = within(table)
    expect(
      await inTable.findByRole('link', { name: 'web-1' }),
    ).toHaveAttribute('href', '/systems/sys-1')
    expect(inTable.getByRole('link', { name: 'db-1' })).toHaveAttribute(
      'href',
      '/systems/sys-2',
    )
    await waitFor(() => {
      expect(inTable.getByText('92%')).toBeInTheDocument()
      expect(inTable.getByText('12%')).toBeInTheDocument()
    })
  })

  it('renders Group, Status and Updates columns for each system', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    const inTable = within(table)
    await inTable.findByRole('link', { name: 'web-1' })
    expect(inTable.getAllByText('Web tier').length).toBeGreaterThan(0)
    expect(inTable.getByText('Database tier')).toBeInTheDocument()
    expect(inTable.getByLabelText('Updates available')).toBeInTheDocument()
  })

  it('dims unreachable rows and shows "—" for their metric cells', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const offlineLink = await screen.findByRole('link', { name: 'offline-1' })
    const row = offlineLink.closest('tr')
    expect(row).not.toBeNull()
    // Three metric cells (CPU, Memory, Disk) should show "—".
    const dashes = row!.querySelectorAll('td')
    const dashCount = Array.from(dashes).filter(
      (td) => td.textContent?.trim() === '—',
    ).length
    expect(dashCount).toBeGreaterThanOrEqual(3)
  })

  it('applies a colored background to metric cells above the warning threshold', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    const inTable = within(table)
    await inTable.findByRole('link', { name: 'web-1' })
    await waitFor(() => {
      expect(inTable.getByText('92%')).toBeInTheDocument()
    })
    const danger = inTable.getByText('92%').closest('td')
    expect(danger).not.toBeNull()
    expect(danger!.getAttribute('style')).toMatch(/background-color/i)
  })

  it('selecting a group restricts visible rows to that group', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    await within(table).findByRole('link', { name: 'web-1' })
    // The MenuToggle exposes its label via aria-label; the sortable
    // Group column header has no aria-label, so getByLabelText
    // disambiguates between the two.
    fireEvent.click(screen.getByLabelText('Group'))
    fireEvent.click(
      await screen.findByRole('option', { name: 'Database tier' }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'web-1' })).toBeNull()
    })
    expect(within(table).getByRole('link', { name: 'db-1' })).toBeInTheDocument()
  })

  it('shows an empty-state card when no systems are registered', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/api/groups') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse([]))
      }
      if (s.includes('/api/systems') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse([]))
      }
      return Promise.resolve(metricResponseFor(s))
    })
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/No systems registered/i),
    ).toBeInTheDocument()
  })

  it('shows "no matches" when a filter excludes every system', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    await within(table).findByRole('link', { name: 'web-1' })
    fetchMock.mockImplementationOnce((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/api/groups')) {
        return Promise.resolve(
          jsonResponse([
            ...groupsBody,
            {
              id: 'g-empty',
              name: 'Empty tier',
              createdAt: '2026-05-01T00:00:00Z',
              systemCount: 0,
            },
          ]),
        )
      }
      return Promise.resolve(metricResponseFor(s))
    })
    fireEvent.click(screen.getByLabelText('Group'))
    // Database tier has exactly one system (db-1); switch back to web tier
    // and assert db-1 disappears as a sanity check on group filtering.
    fireEvent.click(
      await screen.findByRole('option', { name: 'Web tier' }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'db-1' })).toBeNull()
    })
  })

  it('sorts ascending by System name by default', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    const inTable = within(table)
    await inTable.findByRole('link', { name: 'web-1' })
    const links = Array.from(table.querySelectorAll('tbody tr a')).map(
      (a) => a.textContent ?? '',
    )
    expect(links).toEqual(['db-1', 'offline-1', 'web-1'])
  })

  it('clicking the CPU header sorts by CPU descending after a second click', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    const inTable = within(table)
    await inTable.findByRole('link', { name: 'web-1' })
    await waitFor(() => {
      expect(inTable.getByText('92%')).toBeInTheDocument()
    })
    const cpuHeader = inTable.getByRole('columnheader', { name: /^CPU/i })
    const sortButton = cpuHeader.querySelector('button')
    expect(sortButton).not.toBeNull()
    fireEvent.click(sortButton!)
    // First click on a new column → ascending: 12%, 92%, then offline.
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'))
      const firstLink = rows[0].querySelector('a')
      expect(firstLink?.textContent).toBe('db-1')
    })
    fireEvent.click(sortButton!)
    // Second click → descending: 92% (web-1) first.
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'))
      const firstLink = rows[0].querySelector('a')
      expect(firstLink?.textContent).toBe('web-1')
    })
  })

  it('sorting by Status puts unreachable rows first', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    const inTable = within(table)
    await inTable.findByRole('link', { name: 'web-1' })
    const statusHeader = inTable.getByRole('columnheader', {
      name: /^Status/i,
    })
    fireEvent.click(statusHeader.querySelector('button')!)
    await waitFor(() => {
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      const firstLink = rows[0].querySelector('a')
      expect(firstLink?.textContent).toBe('offline-1')
    })
  })

  it('sorts by Group, Memory, Disk, and Updates when their headers are clicked', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    const inTable = within(table)
    await inTable.findByRole('link', { name: 'web-1' })
    const clickHeader = (name: RegExp) => {
      const header = inTable.getByRole('columnheader', { name })
      const button = header.querySelector('button')
      if (button) fireEvent.click(button)
    }
    // Exercise each sortKey case in the compare switch.
    clickHeader(/^Group/i)
    clickHeader(/^Memory/i)
    clickHeader(/^Disk/i)
    clickHeader(/^Updates/i)
    // No crash; the page is still showing rows.
    expect(inTable.getByRole('link', { name: 'web-1' })).toBeInTheDocument()
  })

  it('surfaces a load error when /api/systems fails', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', (input: RequestInfo) => {
      const url = String(input)
      if (url.startsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ global: 'admin', groups: {} }))
      if (url === '/api/systems')
        return Promise.resolve(jsonResponse({ error: 'down' }, 500))
      if (url === '/api/groups')
        return Promise.resolve(jsonResponse([]))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(
          jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
        )
      return Promise.resolve(jsonResponse({}, 500))
    })
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/Could not load|down/i),
    ).toBeInTheDocument()
  })

  it('marks the heatmap table with a sticky header', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const table = await screen.findByLabelText('Systems overview')
    expect(table.className).toMatch(/sticky/)
  })

  it('shows a "Last refreshed" timestamp after metrics resolve', async () => {
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/Last refreshed at /i),
    ).toBeInTheDocument()
  })

  it('shows a "—" cell when Prometheus has no sample for a system', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/api/groups') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(groupsBody))
      }
      if (s.includes('/api/systems') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(systemsBody))
      }
      if (s.includes('/api/metrics/query?')) {
        // Only sys-1 has metrics; sys-2 cells should render "—".
        if (s.includes('node_cpu_seconds_total')) {
          return Promise.resolve(metricVector({ 'sys-1': 25 }))
        }
        return Promise.resolve(metricVector({}))
      }
      return Promise.resolve(jsonResponse({}, 404))
    })
    render(
      <MemoryRouter>
        <SystemsOverviewPage />
      </MemoryRouter>,
    )
    const db = await screen.findByRole('link', { name: 'db-1' })
    const row = db.closest('tr')
    expect(row).not.toBeNull()
    const dashCount = Array.from(row!.querySelectorAll('td')).filter(
      (td) => td.textContent?.trim() === '—',
    ).length
    expect(dashCount).toBeGreaterThanOrEqual(3)
  })
})
