// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BackendReadinessWidget from './BackendReadinessWidget'
import { DashboardProvider } from '../DashboardContext'
import type { DashboardContextValue } from '../dashboardContext'

function ctx(
  overrides: Partial<DashboardContextValue> = {},
): DashboardContextValue {
  return {
    systems: [],
    systemsError: null,
    rebootMetricSet: new Set(),
    health: { status: 'ok' },
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

describe('BackendReadinessWidget', () => {
  it('renders a spinner before readiness loads', () => {
    render(
      <DashboardProvider value={ctx()}>
        <BackendReadinessWidget />
      </DashboardProvider>,
    )
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders the error message when the fetch fails', () => {
    render(
      <DashboardProvider value={ctx({ readinessError: 'network down' })}>
        <BackendReadinessWidget />
      </DashboardProvider>,
    )
    expect(screen.getByText(/error: network down/)).toBeInTheDocument()
  })

  it('renders just the status line when every check is ok', () => {
    render(
      <DashboardProvider
        value={ctx({
          readiness: { status: 'ready', checks: { database: 'ok' } },
        })}
      >
        <BackendReadinessWidget />
      </DashboardProvider>,
    )
    expect(screen.getByText(/status: ready/)).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('shows the error message even when a stale readiness value is still cached', () => {
    // After a poll fails, DashboardPage clears the cached readiness
    // value so this combination shouldn't happen in production — but if
    // a future regression leaves both populated, the error must win so
    // an operator never reads a stale "ready" next to a fresh error.
    render(
      <DashboardProvider
        value={ctx({
          readiness: { status: 'ready', checks: { database: 'ok' } },
          readinessError: 'Failed to fetch',
        })}
      >
        <BackendReadinessWidget />
      </DashboardProvider>,
    )
    expect(screen.getByText(/error: Failed to fetch/)).toBeInTheDocument()
    expect(screen.queryByText(/status: ready/)).toBeNull()
  })

  it('lists the failing checks when status is not_ready', () => {
    render(
      <DashboardProvider
        value={ctx({
          readiness: {
            status: 'not_ready',
            checks: { database: 'connection refused', cache: 'ok' },
          },
        })}
      >
        <BackendReadinessWidget />
      </DashboardProvider>,
    )
    expect(screen.getByText(/status: not_ready/)).toBeInTheDocument()
    expect(
      screen.getByText(/database: connection refused/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/cache: ok/)).toBeNull()
  })
})
