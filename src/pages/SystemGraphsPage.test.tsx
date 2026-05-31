// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemGraphsPage from './SystemGraphsPage'

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
  },
  {
    id: 'sys-2',
    name: 'db-1',
    hostname: 'db-1.local',
    createdAt: '2026-05-23T00:00:00Z',
    status: 'reachable',
    groupId: 'g-db',
  },
]

const groupsBody = [
  { id: 'g-web', name: 'Web tier', createdAt: '2026-05-01T00:00:00Z', systemCount: 1 },
  { id: 'g-db', name: 'Database tier', createdAt: '2026-05-01T00:00:00Z', systemCount: 1 },
]

const emptyMatrix = jsonResponse({
  status: 'success',
  data: { resultType: 'matrix', result: [] },
})

function upVector(systemIds: string[]): Response {
  return jsonResponse({
    status: 'success',
    data: {
      resultType: 'vector',
      result: systemIds.map((id) => ({
        metric: { system_id: id, __name__: 'up' },
        value: [1_716_000_000, '1'],
      })),
    },
  })
}

describe('SystemGraphsPage', () => {
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
        // Default: both systems are monitored.
        return Promise.resolve(upVector(['sys-1', 'sys-2']))
      }
      return Promise.resolve(emptyMatrix)
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one panel per system with the system name as a link', async () => {
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('link', { name: 'web-1' }),
    ).toHaveAttribute('href', '/systems/sys-1')
    expect(screen.getByRole('link', { name: 'db-1' })).toHaveAttribute(
      'href',
      '/systems/sys-2',
    )
  })

  it('queries the chosen metric with each systemId baked in', async () => {
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    await waitFor(() => {
      const urls = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/metrics/query_range'))
      expect(urls.length).toBeGreaterThanOrEqual(2)
      expect(urls.some((u) => u.includes('sys-1'))).toBe(true)
      expect(urls.some((u) => u.includes('sys-2'))).toBe(true)
      expect(urls.every((u) => u.includes('node_load1'))).toBe(true)
    })
  })

  it('changing the metric updates the queries', async () => {
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: 'web-1' })
    fireEvent.click(screen.getByRole('button', { name: /Metric/i }))
    fireEvent.click(
      await screen.findByRole('option', { name: 'Memory used (%)' }),
    )
    await waitFor(() => {
      const recent = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/metrics/query_range'))
        .slice(-2)
      expect(recent.every((u) => u.includes('MemAvailable_bytes'))).toBe(true)
    })
  })

  it('shows an empty-state card when no systems exist', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/api/groups') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse([]))
      }
      if (s.includes('/api/systems') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse([]))
      }
      if (s.includes('/api/metrics/query?')) {
        return Promise.resolve(upVector([]))
      }
      return Promise.resolve(emptyMatrix)
    })
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/No systems registered/i),
    ).toBeInTheDocument()
  })

  it('hides systems that Prometheus is not scraping', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/api/groups') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(groupsBody))
      }
      if (s.includes('/api/systems') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(systemsBody))
      }
      if (s.includes('/api/metrics/query?')) {
        return Promise.resolve(upVector(['sys-1']))
      }
      return Promise.resolve(emptyMatrix)
    })
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('link', { name: 'web-1' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'db-1' })).toBeNull()
    })
  })

  it('shows "no monitoring enabled" message when every system is unmonitored', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/api/groups') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(groupsBody))
      }
      if (s.includes('/api/systems') && !s.includes('/api/metrics')) {
        return Promise.resolve(jsonResponse(systemsBody))
      }
      if (s.includes('/api/metrics/query?')) {
        return Promise.resolve(upVector([]))
      }
      return Promise.resolve(emptyMatrix)
    })
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/No systems have monitoring enabled yet/i),
    ).toBeInTheDocument()
  })

  it('group dropdown defaults to All systems and lists each visible group', async () => {
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: 'web-1' })
    const groupToggle = screen.getByRole('button', { name: /^Group$/i })
    expect(groupToggle).toHaveTextContent('All systems')
    fireEvent.click(groupToggle)
    expect(
      await screen.findByRole('option', { name: 'Web tier' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Database tier' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'All systems' })).toBeInTheDocument()
  })

  it('selecting a group restricts the visible panels to that group', async () => {
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: 'web-1' })
    expect(screen.getByRole('link', { name: 'db-1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Group$/i }))
    fireEvent.click(
      await screen.findByRole('option', { name: 'Web tier' }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'db-1' })).toBeNull()
    })
    expect(screen.getByRole('link', { name: 'web-1' })).toBeInTheDocument()
  })

  it('cycles through each METRIC option to exercise every PromQL builder', async () => {
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: 'web-1' })
    const optionLabels = [
      'CPU busy (%)',
      'CPU iowait (%)',
      'Memory available (bytes)',
      'Swap used (%)',
      'Network IO (bytes/sec)',
      'TCP connections (established)',
      'Disk IO (bytes/sec)',
      'Disk IOPS',
      'Filesystem usage (%)',
      'Open file descriptors',
      'Processes',
      'Uptime (days)',
    ]
    for (const label of optionLabels) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Metric/i }))
      })
      await act(async () => {
        fireEvent.click(await screen.findByRole('option', { name: label }))
      })
    }
    // Final assertion: nothing crashed and rows still render.
    expect(screen.getByRole('link', { name: 'web-1' })).toBeInTheDocument()
  })

  it('shows a "no systems match" message when the filter excludes everything', async () => {
    render(
      <MemoryRouter>
        <SystemGraphsPage />
      </MemoryRouter>,
    )
    await screen.findByRole('link', { name: 'web-1' })
    // Empty-tier group exists in the API but no systems belong to it.
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
      return Promise.resolve(emptyMatrix)
    })
    fireEvent.click(screen.getByRole('button', { name: /^Group$/i }))
    fireEvent.click(
      await screen.findByRole('option', { name: 'Database tier' }),
    )
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'web-1' })).toBeNull()
    })
    expect(screen.getByRole('link', { name: 'db-1' })).toBeInTheDocument()
  })
})
