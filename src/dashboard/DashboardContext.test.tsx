// SPDX-License-Identifier: Apache-2.0

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DashboardProvider } from './DashboardContext'
import {
  useDashboardData,
  type DashboardContextValue,
} from './dashboardContext'

function Consumer() {
  const data = useDashboardData()
  return <span data-testid="health">{data.health?.status ?? 'none'}</span>
}

describe('DashboardContext', () => {
  it('throws when consumed outside a provider', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(
      /useDashboardData must be used inside a DashboardProvider/,
    )
    err.mockRestore()
  })

  it('passes context values to consumers', () => {
    const value: DashboardContextValue = {
      systems: null,
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
    }
    const { getByTestId } = render(
      <DashboardProvider value={value}>
        <Consumer />
      </DashboardProvider>,
    )
    expect(getByTestId('health').textContent).toBe('ok')
  })
})
