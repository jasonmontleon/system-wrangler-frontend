// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import LeaderboardCard from '../../components/LeaderboardCard'
import {
  formatBytesPerSec,
  formatPct,
  tintForPending,
  tintForPercent,
} from '../../components/metricFormatters'
import { useDashboardData } from '../dashboardContext'
import { computeLeaderboards } from '../leaderboards'
import type { Leaderboards } from '../dashboardContext'
import type { WidgetParams } from '../widgets'

type LeaderboardKey = keyof Leaderboards

type Variant = {
  slice: LeaderboardKey
  baseTitle: string
  emptyText: string
  format: (v: number) => string
  tint?: (v: number) => string | undefined
}

const VARIANTS: Record<string, Variant> = {
  busiestCpu: {
    slice: 'busiestCpu',
    baseTitle: 'Busiest CPU',
    emptyText: 'No CPU samples in the current window.',
    format: formatPct,
    tint: tintForPercent,
  },
  lowestFreeMem: {
    slice: 'lowestFreeMem',
    baseTitle: 'Lowest free memory',
    emptyText: 'No memory samples in the current window.',
    format: formatPct,
    tint: tintForPercent,
  },
  lowestFreeDisk: {
    slice: 'lowestFreeDisk',
    baseTitle: 'Lowest free disk',
    emptyText: 'No filesystem samples in the current window.',
    format: formatPct,
    tint: tintForPercent,
  },
  highestNetworkIo: {
    slice: 'highestNetworkIo',
    baseTitle: 'Highest network IO',
    emptyText: 'No network samples in the current window.',
    format: formatBytesPerSec,
  },
  highestDiskIo: {
    slice: 'highestDiskIo',
    baseTitle: 'Highest disk IO',
    emptyText: 'No disk samples in the current window.',
    format: formatBytesPerSec,
  },
  mostPending: {
    slice: 'mostPending',
    baseTitle: 'Most pending updates',
    emptyText: 'No systems have pending updates.',
    format: (v) => String(v),
    tint: tintForPending,
  },
}

function useLeaderboardEntry(slice: LeaderboardKey, groupId: string | undefined) {
  const { systems, metrics, groups } = useDashboardData()
  const data = useMemo(
    () => computeLeaderboards(systems ?? [], metrics, groupId),
    [systems, metrics, groupId],
  )
  const groupName = groupId
    ? (groups.find((g) => g.id === groupId)?.name ?? null)
    : null
  return { entries: data[slice], groupName }
}

function GenericLeaderboardWidget({
  variantKey,
  params,
}: {
  variantKey: keyof typeof VARIANTS
  params?: WidgetParams
}) {
  const variant = VARIANTS[variantKey]
  const { entries, groupName } = useLeaderboardEntry(variant.slice, params?.groupId)
  const title = groupName ? `${variant.baseTitle} — ${groupName}` : variant.baseTitle
  return (
    <LeaderboardCard
      title={title}
      entries={entries}
      format={variant.format}
      tint={variant.tint}
      emptyText={variant.emptyText}
    />
  )
}

export function BusiestCpuWidget({ params }: { params?: WidgetParams } = {}) {
  return <GenericLeaderboardWidget variantKey="busiestCpu" params={params} />
}

export function LowestFreeMemoryWidget({ params }: { params?: WidgetParams } = {}) {
  return <GenericLeaderboardWidget variantKey="lowestFreeMem" params={params} />
}

export function LowestFreeDiskWidget({ params }: { params?: WidgetParams } = {}) {
  return <GenericLeaderboardWidget variantKey="lowestFreeDisk" params={params} />
}

export function HighestNetworkIoWidget({ params }: { params?: WidgetParams } = {}) {
  return <GenericLeaderboardWidget variantKey="highestNetworkIo" params={params} />
}

export function HighestDiskIoWidget({ params }: { params?: WidgetParams } = {}) {
  return <GenericLeaderboardWidget variantKey="highestDiskIo" params={params} />
}

export function MostPendingUpdatesWidget({ params }: { params?: WidgetParams } = {}) {
  return <GenericLeaderboardWidget variantKey="mostPending" params={params} />
}
