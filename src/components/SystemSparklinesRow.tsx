// SPDX-License-Identifier: Apache-2.0

import { Grid, GridItem } from '@patternfly/react-core'
import SparklineCard from './SparklineCard'
import { cpuBusyPct, diskIoBytesPerSec, memUsedPct } from '../api/promql'

// SystemSparklinesRow renders three glance-metric cards above the
// SystemDetailPage tabs. The first card varies by platform: Linux /
// BSD hosts see Load (1m), Windows hosts see CPU busy % (windows_exporter
// does not emit a load-average metric, so the load card would always
// read "—" on Windows). The other two cards are CPU-platform-neutral.
//
// The PromQL bakes in `system_id`, so a single Prometheus target with
// multiple instances on the host is fine — node_exporter only emits
// one set of `node_*` series per host so we don't need an aggregation.
// Disk IO sums read + write across every block device or logical
// volume, rate'd over a 5-minute window — the standard "current
// throughput" recipe.
export default function SystemSparklinesRow({
  systemId,
  isWindows = false,
  onClick,
}: {
  systemId: string
  isWindows?: boolean
  onClick?: () => void
}) {
  const filter = `{system_id="${systemId}"}`
  return (
    <Grid hasGutter>
      <GridItem md={4} sm={12}>
        {isWindows ? (
          <SparklineCard
            title="CPU busy"
            promql={cpuBusyPct(systemId)}
            format={(v) => `${v.toFixed(0)}%`}
            yDomain={[0, 100]}
            onClick={onClick}
          />
        ) : (
          <SparklineCard
            title="Load (1m)"
            promql={`node_load1${filter}`}
            format={(v) => v.toFixed(2)}
            onClick={onClick}
          />
        )}
      </GridItem>
      <GridItem md={4} sm={12}>
        <SparklineCard
          title="Memory used"
          promql={memUsedPct(filter)}
          format={(v) => `${v.toFixed(0)}%`}
          yDomain={[0, 100]}
          onClick={onClick}
        />
      </GridItem>
      <GridItem md={4} sm={12}>
        <SparklineCard
          title="Disk IO"
          promql={diskIoBytesPerSec(systemId)}
          format={formatBytesPerSec}
          onClick={onClick}
        />
      </GridItem>
    </Grid>
  )
}

function formatBytesPerSec(v: number): string {
  const abs = Math.abs(v)
  if (abs < 1000) return `${v.toFixed(0)} B/s`
  if (abs < 1e6) return `${(v / 1000).toFixed(1)} KB/s`
  if (abs < 1e9) return `${(v / 1e6).toFixed(1)} MB/s`
  if (abs < 1e12) return `${(v / 1e9).toFixed(1)} GB/s`
  return `${(v / 1e12).toFixed(1)} TB/s`
}
