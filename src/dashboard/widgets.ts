// SPDX-License-Identifier: Apache-2.0

import type { ComponentType } from 'react'
import { CELL_L, CELL_M, CELL_S, type WidgetCell } from './widgetSize'
import SystemHealthWidget, {
  CompactSystemHealthWidget,
} from './widgets/SystemHealthWidget'
import SystemHealthLegendWidget from './widgets/SystemHealthLegendWidget'
import BackendHealthWidget from './widgets/BackendHealthWidget'
import {
  BusiestCpuWidget,
  HighestDiskIoWidget,
  HighestNetworkIoWidget,
  LowestFreeDiskWidget,
  LowestFreeMemoryWidget,
  MostPendingUpdatesWidget,
} from './widgets/leaderboardWidgets'
import {
  GlobalCpuTrendWidget,
  GlobalDiskIoTrendWidget,
  GlobalFsTrendWidget,
  GlobalMemoryTrendWidget,
  GlobalNetworkIoTrendWidget,
} from './widgets/trendWidgets'
import BlankWidget from './widgets/BlankWidget'

// WidgetParams carries per-instance config for templated widgets. Today
// the only template axis is groupId; future templates (per-OS, per-
// label, per-region) can extend this shape without changing the layout
// envelope.
export type WidgetParams = {
  groupId?: string
}

export type WidgetId =
  | 'system-health'
  | 'system-health-compact'
  | 'system-health-legend'
  | 'backend-health'
  | 'busiest-cpu'
  | 'lowest-free-memory'
  | 'lowest-free-disk'
  | 'highest-network-io'
  | 'highest-disk-io'
  | 'most-pending-updates'
  | 'global-cpu-trend'
  | 'global-memory-trend'
  | 'global-fs-trend'
  | 'global-network-io-trend'
  | 'global-disk-io-trend'
  | 'group-system-health'
  | 'group-system-health-compact'
  | 'group-busiest-cpu'
  | 'group-lowest-free-memory'
  | 'group-lowest-free-disk'
  | 'group-highest-network-io'
  | 'group-highest-disk-io'
  | 'group-most-pending-updates'
  | 'group-cpu-trend'
  | 'group-memory-trend'
  | 'group-fs-trend'
  | 'group-network-io-trend'
  | 'group-disk-io-trend'
  | 'blank-s'
  | 'blank-m'
  | 'blank-l'

export type WidgetSpec = {
  id: WidgetId
  title: string
  description?: string
  defaultEnabled: boolean
  cell: WidgetCell
  // templated widgets can have multiple instances in the layout, each
  // with its own params. The Customize modal exposes an Add affordance
  // that creates instances. Non-templated widgets are single-instance
  // and always present in the default layout.
  templated: boolean
  Component: ComponentType<{ params?: WidgetParams }>
}

// WIDGETS is the source of truth for available dashboard widgets.
// The first 13 are the single-instance widgets that ship in every
// default layout. The remaining 12 are per-group templates the user
// can add instances of via the Customize modal.
export const WIDGETS: ReadonlyArray<WidgetSpec> = [
  {
    id: 'system-health',
    title: 'System health',
    description: 'Donut chart of global system status.',
    defaultEnabled: true,
    cell: CELL_L,
    templated: false,
    Component: SystemHealthWidget,
  },
  {
    id: 'system-health-compact',
    title: 'System health (compact)',
    description: 'Donut chart of global system status, no legend.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: CompactSystemHealthWidget,
  },
  {
    id: 'system-health-legend',
    title: 'System health legend',
    description: 'Standalone legend keying the donut colors to bucket labels.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: SystemHealthLegendWidget,
  },
  {
    id: 'backend-health',
    title: 'Backend health',
    description: 'Liveness of the System Wrangler backend.',
    defaultEnabled: true,
    cell: CELL_S,
    templated: false,
    Component: BackendHealthWidget,
  },
  {
    id: 'busiest-cpu',
    title: 'Busiest CPU',
    description: 'Top systems by CPU busy percentage.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: BusiestCpuWidget,
  },
  {
    id: 'lowest-free-memory',
    title: 'Lowest free memory',
    description: 'Top systems by memory used percentage.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: LowestFreeMemoryWidget,
  },
  {
    id: 'lowest-free-disk',
    title: 'Lowest free disk',
    description: 'Top systems by worst filesystem usage percentage.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: LowestFreeDiskWidget,
  },
  {
    id: 'highest-network-io',
    title: 'Highest network IO',
    description: 'Top systems by total network bytes per second.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: HighestNetworkIoWidget,
  },
  {
    id: 'highest-disk-io',
    title: 'Highest disk IO',
    description: 'Top systems by total disk bytes per second.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: HighestDiskIoWidget,
  },
  {
    id: 'most-pending-updates',
    title: 'Most pending updates',
    description: 'Top systems by pending package updates.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: MostPendingUpdatesWidget,
  },
  {
    id: 'global-cpu-trend',
    title: 'CPU busy trend',
    description: 'Global CPU busy percentage over time.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: GlobalCpuTrendWidget,
  },
  {
    id: 'global-memory-trend',
    title: 'Memory used trend',
    description: 'Global memory used percentage over time.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: GlobalMemoryTrendWidget,
  },
  {
    id: 'global-fs-trend',
    title: 'Worst filesystem trend',
    description: 'Worst per-system filesystem usage over time.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: GlobalFsTrendWidget,
  },
  {
    id: 'global-network-io-trend',
    title: 'Network IO trend',
    description: 'Global network bytes per second over time.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: GlobalNetworkIoTrendWidget,
  },
  {
    id: 'global-disk-io-trend',
    title: 'Disk IO trend',
    description: 'Global disk bytes per second over time.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: false,
    Component: GlobalDiskIoTrendWidget,
  },
  {
    id: 'group-system-health',
    title: 'System health (per group)',
    description: 'Donut chart of system status scoped to one group.',
    defaultEnabled: false,
    cell: CELL_L,
    templated: true,
    Component: SystemHealthWidget,
  },
  {
    id: 'group-system-health-compact',
    title: 'System health, compact (per group)',
    description: 'Donut chart scoped to one group, no legend.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: CompactSystemHealthWidget,
  },
  {
    id: 'group-busiest-cpu',
    title: 'Busiest CPU (per group)',
    description: 'Top systems by CPU busy percentage, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: BusiestCpuWidget,
  },
  {
    id: 'group-lowest-free-memory',
    title: 'Lowest free memory (per group)',
    description: 'Top systems by memory used percentage, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: LowestFreeMemoryWidget,
  },
  {
    id: 'group-lowest-free-disk',
    title: 'Lowest free disk (per group)',
    description: 'Top systems by worst filesystem usage, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: LowestFreeDiskWidget,
  },
  {
    id: 'group-highest-network-io',
    title: 'Highest network IO (per group)',
    description: 'Top systems by network bytes per second, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: HighestNetworkIoWidget,
  },
  {
    id: 'group-highest-disk-io',
    title: 'Highest disk IO (per group)',
    description: 'Top systems by disk bytes per second, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: HighestDiskIoWidget,
  },
  {
    id: 'group-most-pending-updates',
    title: 'Most pending updates (per group)',
    description: 'Top systems by pending updates, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: MostPendingUpdatesWidget,
  },
  {
    id: 'group-cpu-trend',
    title: 'CPU busy trend (per group)',
    description: 'CPU busy percentage over time, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: GlobalCpuTrendWidget,
  },
  {
    id: 'group-memory-trend',
    title: 'Memory used trend (per group)',
    description: 'Memory used percentage over time, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: GlobalMemoryTrendWidget,
  },
  {
    id: 'group-fs-trend',
    title: 'Worst filesystem trend (per group)',
    description: 'Worst per-system filesystem usage over time, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: GlobalFsTrendWidget,
  },
  {
    id: 'group-network-io-trend',
    title: 'Network IO trend (per group)',
    description: 'Network bytes per second over time, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: GlobalNetworkIoTrendWidget,
  },
  {
    id: 'group-disk-io-trend',
    title: 'Disk IO trend (per group)',
    description: 'Disk bytes per second over time, scoped to one group.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: GlobalDiskIoTrendWidget,
  },
  {
    id: 'blank-s',
    title: 'Blank card (small)',
    description: 'Empty spacer card for keeping the grid symmetric.',
    defaultEnabled: false,
    cell: CELL_S,
    templated: true,
    Component: BlankWidget,
  },
  {
    id: 'blank-m',
    title: 'Blank card (medium)',
    description: 'Empty spacer card for keeping the grid symmetric.',
    defaultEnabled: false,
    cell: CELL_M,
    templated: true,
    Component: BlankWidget,
  },
  {
    id: 'blank-l',
    title: 'Blank card (large)',
    description: 'Empty spacer card for keeping the grid symmetric.',
    defaultEnabled: false,
    cell: CELL_L,
    templated: true,
    Component: BlankWidget,
  },
]

// BLANK_WIDGET_IDS captures the spacer templates in S/M/L order, used
// by the Customize modal to surface a quick-add affordance separate
// from the per-group picker.
export const BLANK_WIDGET_IDS: ReadonlyArray<WidgetId> = [
  'blank-s',
  'blank-m',
  'blank-l',
]

export const WIDGETS_BY_ID: ReadonlyMap<WidgetId, WidgetSpec> = new Map(
  WIDGETS.map((w) => [w.id, w]),
)

export const TEMPLATED_WIDGETS: ReadonlyArray<WidgetSpec> = WIDGETS.filter(
  (w) => w.templated,
)

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && WIDGETS_BY_ID.has(value as WidgetId)
}
