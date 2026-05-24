// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  PageSection,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  Stack,
  StackItem,
  Title,
  MenuToggle,
  type MenuToggleElement,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { listSystems, type System } from '../api/systems'
import { listGroups, type Group } from '../api/groups'
import { query } from '../api/metrics'
import { SystemStatusIcon, PendingUpdatesCell } from '../components/systemsTable'

const ALL_GROUPS = '__all__'
const REFRESH_INTERVAL_MS = 30_000
const LEADERBOARD_TOP_N = 5

const FS_FILTER =
  'fstype!~"tmpfs|devtmpfs|squashfs|overlay|ramfs|nsfs|cgroup.*|tracefs|debugfs|fusectl|sysfs|proc|pstore|bpf|configfs|securityfs|hugetlbfs|mqueue|autofs|binfmt_misc"'

const PROMQL = {
  cpu: `100 - (avg by (system_id) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`,
  mem: `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100`,
  disk: `max by (system_id) ((1 - node_filesystem_avail_bytes{${FS_FILTER}} / node_filesystem_size_bytes{${FS_FILTER}}) * 100)`,
}

type MetricBySystem = Map<string, number>

type OverviewMetrics = {
  cpu: MetricBySystem
  mem: MetricBySystem
  disk: MetricBySystem
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; systems: System[]; groups: Group[] }
  | { kind: 'error'; message: string }

type SortKey = 'name' | 'group' | 'status' | 'cpu' | 'mem' | 'disk' | 'pending'
type SortDir = 'asc' | 'desc'

// statusSeverity orders rows by "how much attention does this need".
// Lower number = more attention, so ascending sort puts problems on
// top — a reasonable default for an overview page.
function statusSeverity(s: System): number {
  if (s.status === 'unreachable') return 0
  if (s.lastRunFailed) return 1
  if (s.status === 'reachable' && (s.pendingUpdates ?? 0) > 0) return 2
  if (s.status === 'reachable') return 3
  return 4
}

// numericOrMissing returns the value if present, otherwise an
// infinity-shaped sentinel so missing data always sinks to the
// bottom regardless of sort direction.
function numericOrMissing(v: number | undefined, dir: SortDir): number {
  if (v === undefined || !Number.isFinite(v)) {
    return dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  }
  return v
}

// tintForPercent returns a translucent background that follows
// PatternFly's status palette so the cell tracks the active theme.
// Thresholds: <60 → success, 60–85 → warning, ≥85 → danger.
function tintForPercent(pct: number | undefined): string | undefined {
  if (pct === undefined || !Number.isFinite(pct)) return undefined
  if (pct < 60)
    return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--success--default) 18%, transparent)'
  if (pct < 85)
    return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--warning--default) 22%, transparent)'
  return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--danger--default) 22%, transparent)'
}

function tintForPending(count: number | undefined): string | undefined {
  if (count === undefined || count === 0) return undefined
  if (count < 10)
    return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--warning--default) 22%, transparent)'
  return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--danger--default) 22%, transparent)'
}

function formatPct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(0)}%`
}

type LeaderboardEntry = { system: System; value: number }

function LeaderboardCard({
  title,
  entries,
  format,
  tint,
  emptyText,
}: {
  title: string
  entries: LeaderboardEntry[]
  format: (v: number) => string
  tint: (v: number) => string | undefined
  emptyText: string
}) {
  return (
    <Card isCompact>
      <CardTitle>{title}</CardTitle>
      <CardBody>
        {entries.length === 0 ? (
          <span
            style={{ color: 'var(--pf-t--global--text--color--subtle)' }}
          >
            {emptyText}
          </span>
        ) : (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            {entries.map(({ system, value }) => (
              <div
                key={system.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Link to={`/systems/${system.id}`}>{system.name}</Link>
                <span
                  style={{
                    backgroundColor: tint(value),
                    padding: '0.125rem 0.5rem',
                    borderRadius: '0.25rem',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {format(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
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

export default function SystemsOverviewPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [groupId, setGroupId] = useState<string>(ALL_GROUPS)
  const [groupOpen, setGroupOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [metrics, setMetrics] = useState<OverviewMetrics>({
    cpu: new Map(),
    mem: new Map(),
    disk: new Map(),
  })
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [systems, groups] = await Promise.all([
          listSystems(),
          listGroups(),
        ])
        if (cancelled) return
        setState({ kind: 'ready', systems, groups })
      } catch (err) {
        if (cancelled) return
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const [cpu, mem, disk] = await Promise.all([
          query(PROMQL.cpu),
          query(PROMQL.mem),
          query(PROMQL.disk),
        ])
        if (cancelled) return
        setMetrics({
          cpu: indexBySystemId(cpu),
          mem: indexBySystemId(mem),
          disk: indexBySystemId(disk),
        })
        setLastRefreshedAt(new Date())
      } catch {
        // A failed scrape leaves the previous values in place; cells
        // for never-seen systems stay as "—" because the Map lookup
        // misses. We don't surface a banner — a transient Prometheus
        // blip shouldn't paint the whole page yellow.
      }
    }
    void tick()
    const handle = window.setInterval(() => {
      void tick()
    }, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  const groupName = useMemo(() => {
    if (state.kind !== 'ready') return new Map<string, string>()
    return new Map(state.groups.map((g) => [g.id, g.name]))
  }, [state])

  const visibleSystems = useMemo(() => {
    if (state.kind !== 'ready') return []
    const filtered =
      groupId === ALL_GROUPS
        ? state.systems
        : state.systems.filter((s) => s.groupId === groupId)
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
    const compare = (a: System, b: System): number => {
      switch (sortKey) {
        case 'name':
          return collator.compare(a.name, b.name)
        case 'group': {
          const aName = a.groupId ? (groupName.get(a.groupId) ?? '') : ''
          const bName = b.groupId ? (groupName.get(b.groupId) ?? '') : ''
          // Empty group sinks to the bottom regardless of direction.
          if (aName === '' && bName === '') return 0
          if (aName === '') return sortDir === 'asc' ? 1 : -1
          if (bName === '') return sortDir === 'asc' ? -1 : 1
          return collator.compare(aName, bName)
        }
        case 'status':
          return statusSeverity(a) - statusSeverity(b)
        case 'cpu':
          return (
            numericOrMissing(metrics.cpu.get(a.id), sortDir) -
            numericOrMissing(metrics.cpu.get(b.id), sortDir)
          )
        case 'mem':
          return (
            numericOrMissing(metrics.mem.get(a.id), sortDir) -
            numericOrMissing(metrics.mem.get(b.id), sortDir)
          )
        case 'disk':
          return (
            numericOrMissing(metrics.disk.get(a.id), sortDir) -
            numericOrMissing(metrics.disk.get(b.id), sortDir)
          )
        case 'pending':
          return (
            numericOrMissing(a.pendingUpdates, sortDir) -
            numericOrMissing(b.pendingUpdates, sortDir)
          )
      }
    }
    const sorted = [...filtered].sort((a, b) => {
      const primary = compare(a, b)
      if (primary !== 0) return sortDir === 'asc' ? primary : -primary
      // Stable tiebreak by name so toggling direction doesn't shuffle
      // equal rows arbitrarily.
      return collator.compare(a.name, b.name)
    })
    return sorted
  }, [state, groupId, sortKey, sortDir, metrics, groupName])

  // Leaderboards consume the same metric maps and pendingUpdates as
  // the heatmap below, so they refresh on the same 30 s tick without
  // a separate fetch. Unreachable systems are excluded — their last
  // scrape is stale by definition.
  const leaderboards = useMemo(() => {
    const reachable = visibleSystems.filter((s) => s.status !== 'unreachable')
    const byBusiestCpu = reachable
      .map((s) => ({ system: s, value: metrics.cpu.get(s.id) }))
      .filter(
        (e): e is LeaderboardEntry =>
          e.value !== undefined && Number.isFinite(e.value),
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, LEADERBOARD_TOP_N)
    const byLowestFreeDisk = reachable
      .map((s) => ({ system: s, value: metrics.disk.get(s.id) }))
      .filter(
        (e): e is LeaderboardEntry =>
          e.value !== undefined && Number.isFinite(e.value),
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, LEADERBOARD_TOP_N)
    const byMostPending = reachable
      .map((s) => ({ system: s, value: s.pendingUpdates ?? 0 }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, LEADERBOARD_TOP_N)
    return { byBusiestCpu, byLowestFreeDisk, byMostPending }
  }, [visibleSystems, metrics])

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortFor = (key: SortKey, columnIndex: number) => ({
    sortBy: {
      index: sortKey === key ? columnIndex : undefined,
      direction: sortKey === key ? sortDir : undefined,
      defaultDirection: 'asc' as const,
    },
    onSort: () => onSort(key),
    columnIndex,
  })

  const selectedGroupLabel =
    groupId === ALL_GROUPS
      ? 'All systems'
      : (groupName.get(groupId) ?? 'All systems')

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1">Systems overview</Title>
        </StackItem>
        {state.kind === 'loading' && (
          <StackItem>
            <Bullseye>
              <Spinner size="lg" />
            </Bullseye>
          </StackItem>
        )}
        {state.kind === 'error' && (
          <StackItem>
            <Alert variant="danger" title="Failed to load systems" isInline>
              {state.message}
            </Alert>
          </StackItem>
        )}
        {state.kind === 'ready' && (
          <>
            <StackItem>
              <Flex
                alignItems={{ default: 'alignItemsCenter' }}
                spaceItems={{ default: 'spaceItemsLg' }}
              >
                <FlexItem>
                  <span style={{ marginRight: '0.5rem' }}>Group:</span>
                  <Select
                    isOpen={groupOpen}
                    selected={groupId}
                    onSelect={(_, value) => {
                      setGroupId(String(value))
                      setGroupOpen(false)
                    }}
                    onOpenChange={(o) => setGroupOpen(o)}
                    toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                      <MenuToggle
                        ref={toggleRef}
                        onClick={() => setGroupOpen((v) => !v)}
                        isExpanded={groupOpen}
                        aria-label="Group"
                      >
                        {selectedGroupLabel}
                      </MenuToggle>
                    )}
                  >
                    <SelectList>
                      <SelectOption value={ALL_GROUPS}>All systems</SelectOption>
                      {state.groups.map((g) => (
                        <SelectOption key={g.id} value={g.id}>
                          {g.name}
                        </SelectOption>
                      ))}
                    </SelectList>
                  </Select>
                </FlexItem>
                {lastRefreshedAt && (
                  <FlexItem align={{ default: 'alignRight' }}>
                    <span
                      aria-label="Last refreshed"
                      style={{
                        color: 'var(--pf-t--global--text--color--subtle)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      Last refreshed at {lastRefreshedAt.toLocaleTimeString()}
                    </span>
                  </FlexItem>
                )}
              </Flex>
            </StackItem>
            {visibleSystems.length === 0 ? (
              <StackItem>
                <Card>
                  <CardBody>
                    {state.systems.length === 0 ? (
                      <>
                        No systems registered. Add one on the{' '}
                        <Link to="/systems">Systems</Link> page first.
                      </>
                    ) : (
                      <>No systems match the current group filter.</>
                    )}
                  </CardBody>
                </Card>
              </StackItem>
            ) : (
              <>
                <StackItem>
                  <Grid hasGutter>
                    <GridItem md={4} sm={12}>
                      <LeaderboardCard
                        title="Busiest CPU"
                        entries={leaderboards.byBusiestCpu}
                        format={(v) => formatPct(v)}
                        tint={(v) => tintForPercent(v)}
                        emptyText="No CPU samples in the current window."
                      />
                    </GridItem>
                    <GridItem md={4} sm={12}>
                      <LeaderboardCard
                        title="Lowest free disk"
                        entries={leaderboards.byLowestFreeDisk}
                        format={(v) => formatPct(v)}
                        tint={(v) => tintForPercent(v)}
                        emptyText="No filesystem samples in the current window."
                      />
                    </GridItem>
                    <GridItem md={4} sm={12}>
                      <LeaderboardCard
                        title="Most pending updates"
                        entries={leaderboards.byMostPending}
                        format={(v) => String(v)}
                        tint={(v) => tintForPending(v)}
                        emptyText="No systems have pending updates."
                      />
                    </GridItem>
                  </Grid>
                </StackItem>
                <StackItem>
                  <Table
                    aria-label="Systems overview"
                    variant="compact"
                    isStickyHeader
                  >
                  <Thead>
                    <Tr>
                      <Th width={25} sort={sortFor('name', 0)}>
                        System
                      </Th>
                      <Th width={15} sort={sortFor('group', 1)}>
                        Group
                      </Th>
                      <Th width={10} sort={sortFor('status', 2)}>
                        Status
                      </Th>
                      <Th width={10} sort={sortFor('cpu', 3)}>
                        CPU
                      </Th>
                      <Th width={10} sort={sortFor('mem', 4)}>
                        Memory
                      </Th>
                      <Th width={10} sort={sortFor('disk', 5)}>
                        Disk
                      </Th>
                      <Th width={20} sort={sortFor('pending', 6)}>
                        Updates available
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {visibleSystems.map((sys) => {
                      const dim =
                        sys.status === 'unreachable'
                          ? { opacity: 0.55 }
                          : undefined
                      const cpu = metrics.cpu.get(sys.id)
                      const mem = metrics.mem.get(sys.id)
                      const disk = metrics.disk.get(sys.id)
                      const showMetrics = sys.status !== 'unreachable'
                      return (
                        <Tr key={sys.id} style={dim}>
                          <Td dataLabel="System">
                            <Link to={`/systems/${sys.id}`}>{sys.name}</Link>
                          </Td>
                          <Td dataLabel="Group">
                            {sys.groupId
                              ? (groupName.get(sys.groupId) ?? '—')
                              : '—'}
                          </Td>
                          <Td dataLabel="Status">
                            <SystemStatusIcon
                              status={sys.status}
                              pendingUpdates={sys.pendingUpdates}
                              lastRunFailed={sys.lastRunFailed}
                            />
                          </Td>
                          <Td
                            dataLabel="CPU"
                            style={
                              showMetrics
                                ? { backgroundColor: tintForPercent(cpu) }
                                : undefined
                            }
                          >
                            {showMetrics ? formatPct(cpu) : '—'}
                          </Td>
                          <Td
                            dataLabel="Memory"
                            style={
                              showMetrics
                                ? { backgroundColor: tintForPercent(mem) }
                                : undefined
                            }
                          >
                            {showMetrics ? formatPct(mem) : '—'}
                          </Td>
                          <Td
                            dataLabel="Disk"
                            style={
                              showMetrics
                                ? { backgroundColor: tintForPercent(disk) }
                                : undefined
                            }
                          >
                            {showMetrics ? formatPct(disk) : '—'}
                          </Td>
                          <Td
                            dataLabel="Updates available"
                            style={{
                              backgroundColor: tintForPending(sys.pendingUpdates),
                            }}
                          >
                            <PendingUpdatesCell
                              count={sys.pendingUpdates}
                              packages={sys.pendingPackages}
                            />
                          </Td>
                        </Tr>
                      )
                    })}
                  </Tbody>
                </Table>
                </StackItem>
              </>
            )}
          </>
        )}
      </Stack>
    </PageSection>
  )
}
