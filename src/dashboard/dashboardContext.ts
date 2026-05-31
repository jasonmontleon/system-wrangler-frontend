// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext } from 'react'
import type { System } from '../api/systems'
import type { Group } from '../api/groups'
import type { LeaderboardEntry } from '../components/LeaderboardCard'

export type Leaderboards = {
  busiestCpu: LeaderboardEntry[]
  lowestFreeMem: LeaderboardEntry[]
  lowestFreeDisk: LeaderboardEntry[]
  highestNetworkIo: LeaderboardEntry[]
  highestDiskIo: LeaderboardEntry[]
  mostPending: LeaderboardEntry[]
}

export type BackendHealth = { status: string }

export type MetricBySystem = Map<string, number>

export type DashboardMetrics = {
  cpu: MetricBySystem
  mem: MetricBySystem
  disk: MetricBySystem
  netIo: MetricBySystem
  diskIo: MetricBySystem
}

export type DashboardContextValue = {
  systems: System[] | null
  systemsError: string | null
  rebootMetricSet: Set<string>
  health: BackendHealth | null
  healthError: string | null
  metrics: DashboardMetrics
  groups: Group[]
}

export const DashboardContext = createContext<DashboardContextValue | undefined>(
  undefined,
)

export function useDashboardData(): DashboardContextValue {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error('useDashboardData must be used inside a DashboardProvider')
  }
  return ctx
}
