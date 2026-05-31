// SPDX-License-Identifier: Apache-2.0

import { useMemo, type ReactNode } from 'react'
import { Card, CardBody, CardTitle, EmptyState, EmptyStateBody } from '@patternfly/react-core'
import MetricsPanel, { type ThresholdBand } from '../../components/MetricsPanel'
import TimeRangePicker from '../../components/TimeRangePicker'
import { TimeRangeProvider } from '../../components/TimeRangeProvider'
import { DEFAULT_PRESET_SECONDS } from '../../hooks/useTimeRange'
import { PERCENT_ATTENTION_BANDS } from '../../components/metricFormatters'
import {
  cpuBusyPctGlobal,
  cpuBusyPctGroup,
  diskIoBytesPerSecGlobal,
  diskIoBytesPerSecGroup,
  fsUsedPctGlobal,
  fsUsedPctGroup,
  memUsedPctGlobal,
  memUsedPctGroup,
  netIoBytesPerSecGlobal,
  netIoBytesPerSecGroup,
} from '../../api/promql'
import { aggSeriesLabel } from './trendHelpers'
import { useDashboardData } from '../dashboardContext'
import type { WidgetParams } from '../widgets'

type PromqlBuilder = {
  global: () => string
  group: (ids: readonly string[]) => string
}

type TrendSpec = {
  baseTitle: string
  promql: PromqlBuilder
  yDomain?: [number, number]
  thresholds?: ThresholdBand[]
}

const CPU_TREND: TrendSpec = {
  baseTitle: 'CPU busy (%)',
  promql: { global: cpuBusyPctGlobal, group: cpuBusyPctGroup },
  yDomain: [0, 100],
  thresholds: PERCENT_ATTENTION_BANDS,
}

const MEMORY_TREND: TrendSpec = {
  baseTitle: 'Memory used (%)',
  promql: { global: memUsedPctGlobal, group: memUsedPctGroup },
  yDomain: [0, 100],
  thresholds: PERCENT_ATTENTION_BANDS,
}

const FS_TREND: TrendSpec = {
  baseTitle: 'Worst filesystem usage (%)',
  promql: { global: fsUsedPctGlobal, group: fsUsedPctGroup },
  yDomain: [0, 100],
  thresholds: PERCENT_ATTENTION_BANDS,
}

const NETWORK_IO_TREND: TrendSpec = {
  baseTitle: 'Network IO (bytes/sec)',
  promql: { global: netIoBytesPerSecGlobal, group: netIoBytesPerSecGroup },
}

const DISK_IO_TREND: TrendSpec = {
  baseTitle: 'Disk IO (bytes/sec)',
  promql: { global: diskIoBytesPerSecGlobal, group: diskIoBytesPerSecGroup },
}

// TrendWidget renders a single time-series card. Each card owns its
// own TimeRangeProvider so the picker on one card doesn't move the
// chart on the next. When `groupId` is set the PromQL is constrained
// to the group's members; the systems-list lookup happens here, the
// query string is composed via the per-group helpers in api/promql.
function TrendWidget({
  spec,
  params,
}: {
  spec: TrendSpec
  params?: WidgetParams
}) {
  const { systems, groups } = useDashboardData()
  const groupId = params?.groupId
  const groupSystemIds = useMemo(() => {
    if (!groupId) return null
    return (systems ?? [])
      .filter((s) => s.groupId === groupId)
      .map((s) => s.id)
  }, [systems, groupId])
  const groupName = groupId
    ? (groups.find((g) => g.id === groupId)?.name ?? null)
    : null
  const title: ReactNode = groupName
    ? `${spec.baseTitle} — ${groupName}`
    : spec.baseTitle

  if (groupId && groupSystemIds !== null && groupSystemIds.length === 0) {
    return (
      <Card style={{ height: '100%' }}>
        <CardTitle>{title}</CardTitle>
        <CardBody>
          <EmptyState titleText="No systems" headingLevel="h2">
            <EmptyStateBody>No systems in this group yet.</EmptyStateBody>
          </EmptyState>
        </CardBody>
      </Card>
    )
  }

  const promql =
    groupId && groupSystemIds !== null
      ? spec.promql.group(groupSystemIds)
      : spec.promql.global()

  return (
    <TimeRangeProvider defaultSeconds={DEFAULT_PRESET_SECONDS}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        <div style={{ marginBottom: '0.5rem' }}>
          <TimeRangePicker defaultSeconds={DEFAULT_PRESET_SECONDS} />
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0 }}>
          <MetricsPanel
            title={title}
            promql={promql}
            yDomain={spec.yDomain}
            seriesLabel={aggSeriesLabel}
            thresholds={spec.thresholds}
            fillHeight
            chartHeight={180}
          />
        </div>
      </div>
    </TimeRangeProvider>
  )
}

export function GlobalCpuTrendWidget({ params }: { params?: WidgetParams } = {}) {
  return <TrendWidget spec={CPU_TREND} params={params} />
}

export function GlobalMemoryTrendWidget({ params }: { params?: WidgetParams } = {}) {
  return <TrendWidget spec={MEMORY_TREND} params={params} />
}

export function GlobalFsTrendWidget({ params }: { params?: WidgetParams } = {}) {
  return <TrendWidget spec={FS_TREND} params={params} />
}

export function GlobalNetworkIoTrendWidget({ params }: { params?: WidgetParams } = {}) {
  return <TrendWidget spec={NETWORK_IO_TREND} params={params} />
}

export function GlobalDiskIoTrendWidget({ params }: { params?: WidgetParams } = {}) {
  return <TrendWidget spec={DISK_IO_TREND} params={params} />
}
