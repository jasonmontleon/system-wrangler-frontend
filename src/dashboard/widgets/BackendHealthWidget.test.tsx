// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BackendHealthWidget from './BackendHealthWidget'
import { DashboardProvider } from '../DashboardContext'
import type { DashboardContextValue } from '../dashboardContext'

function ctx(
  overrides: Partial<DashboardContextValue> = {},
): DashboardContextValue {
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

describe('BackendHealthWidget', () => {
  it('renders a spinner before health loads', () => {
    render(
      <DashboardProvider value={ctx()}>
        <BackendHealthWidget />
      </DashboardProvider>,
    )
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders the status when the fetch succeeds', () => {
    render(
      <DashboardProvider value={ctx({ health: { status: 'ok' } })}>
        <BackendHealthWidget />
      </DashboardProvider>,
    )
    expect(screen.getByText(/status: ok/)).toBeInTheDocument()
  })

  it('renders the error message when the fetch fails', () => {
    render(
      <DashboardProvider value={ctx({ healthError: 'Failed to fetch' })}>
        <BackendHealthWidget />
      </DashboardProvider>,
    )
    expect(screen.getByText(/error: Failed to fetch/)).toBeInTheDocument()
  })

  it('error supersedes a stale cached health value', () => {
    // Defensive: DashboardPage clears the cached health on a failed poll
    // so this should never occur in production, but the widget must still
    // render only the error so an operator does not read a stale "ok"
    // next to a fresh error.
    render(
      <DashboardProvider
        value={ctx({
          health: { status: 'ok' },
          healthError: 'Failed to fetch',
        })}
      >
        <BackendHealthWidget />
      </DashboardProvider>,
    )
    expect(screen.getByText(/error: Failed to fetch/)).toBeInTheDocument()
    expect(screen.queryByText(/status: ok/)).toBeNull()
  })
})
