// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import SystemHealthWidget from './SystemHealthWidget'
import {
  DashboardContext,
  type DashboardContextValue,
} from '../dashboardContext'
import type { System } from '../../api/systems'
import type { Group } from '../../api/groups'

function sys(overrides: Partial<System> = {}): System {
  return {
    id: 's-' + Math.random().toString(36).slice(2, 8),
    name: 'host',
    hostname: '10.0.0.1',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'reachable',
    ...overrides,
  }
}

function ctx(overrides: Partial<DashboardContextValue> = {}): DashboardContextValue {
  return {
    systems: [],
    systemsError: null,
    rebootMetricSet: new Set(),
    health: null,
    healthError: null,
    readiness: null,
    readinessError: null,
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

function renderWidget(
  value: DashboardContextValue,
  params?: { groupId?: string },
) {
  return render(
    <DashboardContext.Provider value={value}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<SystemHealthWidget params={params} />} />
          <Route path="/systems" element={<div>Systems list page</div>} />
          <Route
            path="/groups/:groupId"
            element={<div>Group detail page</div>}
          />
        </Routes>
      </MemoryRouter>
    </DashboardContext.Provider>,
  )
}

describe('SystemHealthWidget center caption navigation', () => {
  it('navigates the all-systems donut caption to the Systems list', () => {
    renderWidget(ctx({ systems: [sys(), sys()] }))

    const caption = screen.getByLabelText('Go to all systems')
    expect(caption).toBeInTheDocument()
    fireEvent.click(caption)

    expect(screen.getByText('Systems list page')).toBeInTheDocument()
  })

  it('navigates when the center count is clicked, too', () => {
    // Spread across three buckets so no legend cell also reads "3" —
    // the only "3" on screen is the donut center total.
    renderWidget(
      ctx({
        systems: [sys(), sys({ pendingUpdates: 1 }), sys({ status: 'unreachable' })],
      }),
    )

    fireEvent.click(screen.getByText('3'))

    expect(screen.getByText('Systems list page')).toBeInTheDocument()
  })

  it('navigates a group donut caption to that group page', () => {
    const group: Group = {
      id: 'g-1',
      name: 'Prod',
      createdAt: '2026-01-01T00:00:00Z',
      systemCount: 1,
    }
    renderWidget(
      ctx({ systems: [sys({ groupId: 'g-1' })], groups: [group] }),
      { groupId: 'g-1' },
    )

    const caption = screen.getByLabelText('Go to the Prod group')
    fireEvent.click(caption)

    expect(screen.getByText('Group detail page')).toBeInTheDocument()
  })

  it('navigates on keyboard Enter for keyboard users', () => {
    renderWidget(ctx({ systems: [sys()] }))

    const caption = screen.getByLabelText('Go to all systems')
    fireEvent.keyDown(caption, { key: 'Enter' })

    expect(screen.getByText('Systems list page')).toBeInTheDocument()
  })
})
