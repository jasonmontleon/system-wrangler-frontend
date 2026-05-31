// SPDX-License-Identifier: Apache-2.0

import type { System } from '../api/systems'
import type { LeaderboardEntry } from '../components/LeaderboardCard'
import type { DashboardMetrics, Leaderboards } from './dashboardContext'

export const LEADERBOARD_TOP_N = 5

// computeLeaderboards derives the six leaderboard slices from the raw
// systems list + Prometheus metric maps. Optional groupId restricts to
// systems whose `groupId` matches — used by per-group leaderboard
// widgets so each card sees only its group's members.
export function computeLeaderboards(
  systems: System[],
  metrics: DashboardMetrics,
  groupId?: string,
): Leaderboards {
  const reachable = systems.filter(
    (s) => s.status !== 'unreachable' && (!groupId || s.groupId === groupId),
  )
  const topBy = (
    getValue: (s: System) => number | undefined,
    requirePositive = false,
  ): LeaderboardEntry[] =>
    reachable
      .map((s) => ({ system: s, value: getValue(s) }))
      .filter(
        (e): e is LeaderboardEntry =>
          e.value !== undefined &&
          Number.isFinite(e.value) &&
          (!requirePositive || e.value > 0),
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, LEADERBOARD_TOP_N)
  return {
    busiestCpu: topBy((s) => metrics.cpu.get(s.id)),
    lowestFreeMem: topBy((s) => metrics.mem.get(s.id)),
    lowestFreeDisk: topBy((s) => metrics.disk.get(s.id)),
    highestNetworkIo: topBy((s) => metrics.netIo.get(s.id)),
    highestDiskIo: topBy((s) => metrics.diskIo.get(s.id)),
    mostPending: topBy((s) => s.pendingUpdates, true),
  }
}
