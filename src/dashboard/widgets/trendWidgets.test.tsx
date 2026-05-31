// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardProvider } from '../DashboardContext'
import type { DashboardContextValue } from '../dashboardContext'
import { GlobalCpuTrendWidget } from './trendWidgets'

function emptyMatrix(): Response {
  return new Response(
    JSON.stringify({
      status: 'success',
      data: { resultType: 'matrix', result: [] },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

function ctx(overrides: Partial<DashboardContextValue> = {}): DashboardContextValue {
  return {
    systems: [],
    systemsError: null,
    rebootMetricSet: new Set(),
    health: { status: 'ok' },
    healthError: null,
    metrics: {
      cpu: new Map(),
      mem: new Map(),
      disk: new Map(),
      netIo: new Map(),
      diskIo: new Map(),
    },
    groups: [],
    ...overrides,
  }
}

describe('TrendWidget per-group rendering', () => {
  it('renders the empty-state card when the group has no systems', () => {
    render(
      <DashboardProvider
        value={ctx({
          systems: [],
          groups: [
            { id: 'g1', name: 'production', createdAt: '', systemCount: 0 },
          ],
        })}
      >
        <GlobalCpuTrendWidget params={{ groupId: 'g1' }} />
      </DashboardProvider>,
    )
    expect(screen.getByText(/No systems in this group/i)).toBeInTheDocument()
    expect(screen.getByText(/CPU busy \(%\) — production/)).toBeInTheDocument()
  })

  it('renders the chart with per-group PromQL when the group has members', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(emptyMatrix())
    vi.stubGlobal('fetch', fetchSpy)
    try {
      render(
        <DashboardProvider
          value={ctx({
            systems: [
              {
                id: 'sys-1',
                name: 'web',
                hostname: '10.0.0.1',
                createdAt: '',
                status: 'reachable',
                groupId: 'g1',
              },
            ],
            groups: [
              { id: 'g1', name: 'production', createdAt: '', systemCount: 1 },
            ],
          })}
        >
          <GlobalCpuTrendWidget params={{ groupId: 'g1' }} />
        </DashboardProvider>,
      )
      await waitFor(() => {
        const promqlUrls = fetchSpy.mock.calls
          .map((c) => String(c[0]))
          .filter((u) => u.includes('/api/metrics/query_range'))
        expect(promqlUrls.length).toBeGreaterThan(0)
        // The per-group helper builds a system_id="sys-1" selector
        // (single-id case uses the equality form, not the regex).
        expect(promqlUrls.some((u) => u.includes('system_id'))).toBe(true)
        expect(promqlUrls.some((u) => u.includes('sys-1'))).toBe(true)
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
