// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core'
import { ChartDonut } from '@patternfly/react-charts/victory'
import { apiFetch } from '../api/client'
import { listSystems, type System } from '../api/systems'
import { query } from '../api/metrics'
import { useEventStream } from '../hooks/useEventStream'
import LeaderboardCard, {
  type LeaderboardEntry,
} from '../components/LeaderboardCard'
import {
  formatBytesPerSec,
  formatPct,
  tintForPending,
  tintForPercent,
} from '../components/metricFormatters'

type Health = { status: string }

const LEADERBOARD_TOP_N = 5
const METRIC_REFRESH_INTERVAL_MS = 30_000

const FS_FILTER =
  'fstype!~"tmpfs|devtmpfs|squashfs|overlay|ramfs|nsfs|cgroup.*|tracefs|debugfs|fusectl|sysfs|proc|pstore|bpf|configfs|securityfs|hugetlbfs|mqueue|autofs|binfmt_misc"'
const NET_FILTER = 'device!~"lo|docker.*|veth.*|cni.*|br-.*|virbr.*"'

const PROMQL = {
  cpu: `100 - (avg by (system_id) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`,
  mem: `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100`,
  disk: `max by (system_id) ((1 - node_filesystem_avail_bytes{${FS_FILTER}} / node_filesystem_size_bytes{${FS_FILTER}}) * 100)`,
  netIo: `sum by (system_id) (rate(node_network_receive_bytes_total{${NET_FILTER}}[5m])) + sum by (system_id) (rate(node_network_transmit_bytes_total{${NET_FILTER}}[5m]))`,
  diskIo: `sum by (system_id) (rate(node_disk_read_bytes_total[5m])) + sum by (system_id) (rate(node_disk_written_bytes_total[5m]))`,
}

type MetricBySystem = Map<string, number>

type DashboardMetrics = {
  cpu: MetricBySystem
  mem: MetricBySystem
  disk: MetricBySystem
  netIo: MetricBySystem
  diskIo: MetricBySystem
}

function indexBySystemId(
  vector: { metric: Record<string, string>; value: [number, string] }[],
): MetricBySystem {
  const map: MetricBySystem = new Map()
  for (const entry of vector) {
    const id = entry.metric.system_id
    if (!id) continue
    const n = Number(entry.value[1])
    if (Number.isFinite(n)) map.set(id, n)
  }
  return map
}

// HealthBucket is one of five mutually exclusive states each system
// rolls up to. The precedence matches SystemStatusIcon so the donut
// can't disagree with the per-row glyph on the Systems page.
type HealthBucket =
  | 'healthy'
  | 'updates'
  | 'unreachable'
  | 'failed'
  | 'unknown'

type BucketSpec = {
  key: HealthBucket
  label: string
  color: string
}

// PatternFly v6 status hex codes mirrored here so the SVG-rendered
// donut can use them directly. The icons on the Systems page pull
// these via CSS custom properties; the chart is rendered inline and
// can't pierce CSS vars cleanly, so the hex codes live alongside.
const BUCKETS: BucketSpec[] = [
  { key: 'healthy', label: 'Healthy', color: '#3E8635' },
  { key: 'updates', label: 'Updates available', color: '#F0AB00' },
  { key: 'unreachable', label: 'Unreachable', color: '#C9190B' },
  { key: 'failed', label: 'Failed run', color: '#7D1007' },
  { key: 'unknown', label: 'Unknown', color: '#8A8D90' },
]

function classify(s: System): HealthBucket {
  if (s.status === 'unreachable') return 'unreachable'
  if (s.lastRunFailed) return 'failed'
  if (s.status === 'reachable' && s.pendingUpdates !== undefined) {
    return s.pendingUpdates === 0 ? 'healthy' : 'updates'
  }
  return 'unknown'
}

function tally(systems: System[]): Record<HealthBucket, number> {
  const out: Record<HealthBucket, number> = {
    healthy: 0,
    updates: 0,
    unreachable: 0,
    failed: 0,
    unknown: 0,
  }
  for (const s of systems) {
    out[classify(s)] += 1
  }
  return out
}

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [systems, setSystems] = useState<System[] | null>(null)
  const [systemsError, setSystemsError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    cpu: new Map(),
    mem: new Map(),
    disk: new Map(),
    netIo: new Map(),
    diskIo: new Map(),
  })

  useEffect(() => {
    apiFetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e) => setHealthError(String(e)))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const data = await listSystems()
      setSystems(data)
      setSystemsError(null)
    } catch (e) {
      setSystemsError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Debounced refresh on the systems.changed event so a fleet-wide
  // Check on the Systems page (or a probe tick) ripples here without
  // flooding the API.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEventStream(
    useCallback(
      (event) => {
        if (event.type !== 'systems.changed') return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          void refresh()
        }, 200)
      },
      [refresh],
    ),
  )
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Five Prometheus instant queries refreshed every 30 s drive the
  // leaderboards. A failed scrape leaves the previous values in place
  // so a transient blip doesn't blank the cards.
  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const [cpu, mem, disk, netIo, diskIo] = await Promise.all([
          query(PROMQL.cpu),
          query(PROMQL.mem),
          query(PROMQL.disk),
          query(PROMQL.netIo),
          query(PROMQL.diskIo),
        ])
        if (cancelled) return
        setMetrics({
          cpu: indexBySystemId(cpu),
          mem: indexBySystemId(mem),
          disk: indexBySystemId(disk),
          netIo: indexBySystemId(netIo),
          diskIo: indexBySystemId(diskIo),
        })
      } catch {
        // Soft-fail: keep last good values.
      }
    }
    void tick()
    const handle = window.setInterval(() => {
      void tick()
    }, METRIC_REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  const leaderboards = useMemo(() => {
    const reachable = (systems ?? []).filter(
      (s) => s.status !== 'unreachable',
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
  }, [systems, metrics])

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Dashboard</Title>
      </PageSection>
      <PageSection aria-label="Fleet summary and leaderboards">
        <div
          style={{
            columnWidth: '24rem',
            columnGap: '1rem',
          }}
        >
          <MasonryItem>
            <SystemHealthCard
              systems={systems}
              loadError={systemsError}
            />
          </MasonryItem>
          <MasonryItem>
            <Card>
              <CardTitle>Backend health</CardTitle>
              <CardBody>
                {healthError && <span>error: {healthError}</span>}
                {!healthError && !health && (
                  <Bullseye>
                    <Spinner />
                  </Bullseye>
                )}
                {health && <span>status: {health.status}</span>}
              </CardBody>
            </Card>
          </MasonryItem>
          <MasonryItem>
            <LeaderboardCard
              title="Busiest CPU"
              entries={leaderboards.busiestCpu}
              format={formatPct}
              tint={tintForPercent}
              emptyText="No CPU samples in the current window."
            />
          </MasonryItem>
          <MasonryItem>
            <LeaderboardCard
              title="Lowest free memory"
              entries={leaderboards.lowestFreeMem}
              format={formatPct}
              tint={tintForPercent}
              emptyText="No memory samples in the current window."
            />
          </MasonryItem>
          <MasonryItem>
            <LeaderboardCard
              title="Lowest free disk"
              entries={leaderboards.lowestFreeDisk}
              format={formatPct}
              tint={tintForPercent}
              emptyText="No filesystem samples in the current window."
            />
          </MasonryItem>
          <MasonryItem>
            <LeaderboardCard
              title="Highest network IO"
              entries={leaderboards.highestNetworkIo}
              format={formatBytesPerSec}
              emptyText="No network samples in the current window."
            />
          </MasonryItem>
          <MasonryItem>
            <LeaderboardCard
              title="Highest disk IO"
              entries={leaderboards.highestDiskIo}
              format={formatBytesPerSec}
              emptyText="No disk samples in the current window."
            />
          </MasonryItem>
          <MasonryItem>
            <LeaderboardCard
              title="Most pending updates"
              entries={leaderboards.mostPending}
              format={(v) => String(v)}
              tint={tintForPending}
              emptyText="No systems have pending updates."
            />
          </MasonryItem>
        </div>
      </PageSection>
    </>
  )
}

// MasonryItem wraps each card so CSS multi-column layout treats the
// card as an atomic unit — short cards slot in beside or under tall
// ones (Pinterest-style) instead of stretching to a row baseline.
function MasonryItem({ children }: { children: ReactNode }) {
  return (
    <div style={{ breakInside: 'avoid', marginBottom: '1rem' }}>
      {children}
    </div>
  )
}

function SystemHealthCard({
  systems,
  loadError,
}: {
  systems: System[] | null
  loadError: string | null
}) {
  const counts = useMemo(
    () => (systems ? tally(systems) : null),
    [systems],
  )
  const total = systems?.length ?? 0

  return (
    <Card>
      <CardTitle>System health</CardTitle>
      <CardBody>
        {loadError && (
          <Alert variant="danger" title="Could not load systems" isInline>
            {loadError}
          </Alert>
        )}
        {!loadError && systems === null && (
          <Bullseye style={{ minHeight: '12rem' }}>
            <Spinner />
          </Bullseye>
        )}
        {!loadError && systems !== null && total === 0 && (
          <EmptyState titleText="No systems yet" headingLevel="h2">
            <EmptyStateBody>
              Add a system from the Systems page to start seeing health
              data here.
            </EmptyStateBody>
          </EmptyState>
        )}
        {!loadError && counts && total > 0 && (
          <Flex
            direction={{ default: 'column' }}
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsMd' }}
          >
            <FlexItem>
              <div style={{ height: 320, width: 320 }}>
                <ChartDonut
                  ariaDesc="System health distribution"
                  ariaTitle="System health"
                  constrainToVisibleArea
                  data={BUCKETS.map((b) => ({
                    x: b.label,
                    y: counts[b.key],
                  }))}
                  labels={({ datum }: { datum: { x: string; y: number } }) =>
                    `${datum.x}: ${datum.y}`
                  }
                  colorScale={BUCKETS.map((b) => b.color)}
                  height={320}
                  width={320}
                  innerRadius={90}
                  title={String(total)}
                  subTitle={total === 1 ? 'System' : 'Systems'}
                />
              </div>
            </FlexItem>
            <FlexItem alignSelf={{ default: 'alignSelfStretch' }}>
              <BucketLegend counts={counts} />
            </FlexItem>
          </Flex>
        )}
      </CardBody>
    </Card>
  )
}

function BucketLegend({ counts }: { counts: Record<HealthBucket, number> }) {
  return (
    <Grid hasGutter>
      {BUCKETS.map((b) => (
        <GridItem key={b.key} span={12}>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsSm' }}
          >
            <FlexItem>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: '0.75rem',
                  height: '0.75rem',
                  borderRadius: '50%',
                  backgroundColor: b.color,
                  verticalAlign: 'middle',
                }}
              />
            </FlexItem>
            <FlexItem flex={{ default: 'flex_1' }}>{b.label}</FlexItem>
            <FlexItem>
              <strong aria-label={`${b.label} count`}>{counts[b.key]}</strong>
            </FlexItem>
          </Flex>
        </GridItem>
      ))}
    </Grid>
  )
}
