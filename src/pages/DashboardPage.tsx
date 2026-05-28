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
import { queryRebootRequiredSet } from '../util/rebootSignal'
import {
  cpuBusyPct,
  cpuBusyPctGlobal,
  diskIoBytesPerSec,
  diskIoBytesPerSecGlobal,
  fsUsedPctGlobal,
  fsUsedPctMax,
  memUsedPct,
  memUsedPctGlobal,
  netIoBytesPerSec,
  netIoBytesPerSecGlobal,
} from '../api/promql'
import MetricsPanel from '../components/MetricsPanel'
import TimeRangePicker from '../components/TimeRangePicker'
import { TimeRangeProvider } from '../components/TimeRangeProvider'
import { DEFAULT_PRESET_SECONDS } from '../hooks/useTimeRange'
import { useEventStream } from '../hooks/useEventStream'
import LeaderboardCard, {
  type LeaderboardEntry,
} from '../components/LeaderboardCard'
import {
  formatBytesPerSec,
  formatPct,
  PERCENT_ATTENTION_BANDS,
  tintForPending,
  tintForPercent,
} from '../components/metricFormatters'

type Health = { status: string }

const LEADERBOARD_TOP_N = 5
const METRIC_REFRESH_INTERVAL_MS = 30_000

const PROMQL = {
  cpu: cpuBusyPct(),
  mem: memUsedPct(),
  disk: fsUsedPctMax(),
  netIo: netIoBytesPerSec(),
  diskIo: diskIoBytesPerSec(),
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

// HealthBucket is one of six mutually exclusive states each system
// rolls up to. The precedence matches SystemStatusIcon so the donut
// can't disagree with the per-row glyph on the Systems page.
type HealthBucket =
  | 'healthy'
  | 'updates'
  | 'reboot'
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
  { key: 'reboot', label: 'Reboot required', color: '#EC7A08' },
  { key: 'unreachable', label: 'Unreachable', color: '#C9190B' },
  { key: 'failed', label: 'Failed run', color: '#7D1007' },
  { key: 'unknown', label: 'Unknown', color: '#8A8D90' },
]

function classify(s: System, rebootMetricSet: Set<string>): HealthBucket {
  if (s.status === 'unreachable') return 'unreachable'
  if (s.lastRunFailed) return 'failed'
  if (s.rebootRequiredAt || rebootMetricSet.has(s.id)) return 'reboot'
  if (s.status === 'reachable' && s.pendingUpdates !== undefined) {
    return s.pendingUpdates === 0 ? 'healthy' : 'updates'
  }
  return 'unknown'
}

function tally(
  systems: System[],
  rebootMetricSet: Set<string>,
): Record<HealthBucket, number> {
  const out: Record<HealthBucket, number> = {
    healthy: 0,
    updates: 0,
    reboot: 0,
    unreachable: 0,
    failed: 0,
    unknown: 0,
  }
  for (const s of systems) {
    out[classify(s, rebootMetricSet)] += 1
  }
  return out
}

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [systems, setSystems] = useState<System[] | null>(null)
  const [systemsError, setSystemsError] = useState<string | null>(null)
  const [rebootMetricSet, setRebootMetricSet] = useState<Set<string>>(new Set())
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
        const [cpu, mem, disk, netIo, diskIo, rebootSet] = await Promise.all([
          query(PROMQL.cpu),
          query(PROMQL.mem),
          query(PROMQL.disk),
          query(PROMQL.netIo),
          query(PROMQL.diskIo),
          queryRebootRequiredSet(),
        ])
        if (cancelled) return
        setRebootMetricSet(rebootSet)
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
      <PageSection aria-label="Global summary and leaderboards">
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
              rebootMetricSet={rebootMetricSet}
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
      <PageSection aria-label="Global trends">
        <Title headingLevel="h2" size="lg" style={{ marginBottom: '1rem' }}>
          Global trends
        </Title>
        <TimeRangeProvider defaultSeconds={DEFAULT_PRESET_SECONDS}>
          <div style={{ marginBottom: '1rem' }}>
            <TimeRangePicker defaultSeconds={DEFAULT_PRESET_SECONDS} />
          </div>
          <Grid hasGutter>
            <GridItem md={6} sm={12}>
              <MetricsPanel
                title="CPU busy (%)"
                promql={cpuBusyPctGlobal()}
                yDomain={[0, 100]}
                seriesLabel={aggSeriesLabel}
                thresholds={PERCENT_ATTENTION_BANDS}
              />
            </GridItem>
            <GridItem md={6} sm={12}>
              <MetricsPanel
                title="Memory used (%)"
                promql={memUsedPctGlobal()}
                yDomain={[0, 100]}
                seriesLabel={aggSeriesLabel}
                thresholds={PERCENT_ATTENTION_BANDS}
              />
            </GridItem>
            <GridItem md={6} sm={12}>
              <MetricsPanel
                title="Worst filesystem usage (%)"
                promql={fsUsedPctGlobal()}
                yDomain={[0, 100]}
                seriesLabel={aggSeriesLabel}
                thresholds={PERCENT_ATTENTION_BANDS}
              />
            </GridItem>
            <GridItem md={6} sm={12}>
              <MetricsPanel
                title="Network IO (bytes/sec, all systems)"
                promql={netIoBytesPerSecGlobal()}
              />
            </GridItem>
            <GridItem md={6} sm={12}>
              <MetricsPanel
                title="Disk IO (bytes/sec, all systems)"
                promql={diskIoBytesPerSecGlobal()}
              />
            </GridItem>
          </Grid>
        </TimeRangeProvider>
      </PageSection>
    </>
  )
}

function aggSeriesLabel(metric: Record<string, string>): string {
  if (metric.agg === 'avg') return 'Average'
  if (metric.agg === 'peak') return 'Peak'
  return ''
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
  rebootMetricSet,
}: {
  systems: System[] | null
  loadError: string | null
  rebootMetricSet: Set<string>
}) {
  const counts = useMemo(
    () => (systems ? tally(systems, rebootMetricSet) : null),
    [systems, rebootMetricSet],
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
