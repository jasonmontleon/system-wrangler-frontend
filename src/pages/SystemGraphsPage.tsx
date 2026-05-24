// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
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
import MetricsPanel from '../components/MetricsPanel'
import TimeRangePicker from '../components/TimeRangePicker'
import { TimeRangeProvider } from '../components/TimeRangeProvider'
import { DEFAULT_PRESET_SECONDS } from '../hooks/useTimeRange'
import { formatMountLabel } from '../components/metricFormatters'
import { listSystems, type System } from '../api/systems'
import { listGroups, type Group } from '../api/groups'
import { query } from '../api/metrics'
import {
  cpuBusyPct,
  diskIoBytesBidi,
  diskIopsBidi,
  fsUsedPctPerMount,
  memAvailBytes,
  memUsedPct,
  netIoBidi,
  tcpEstablished,
  uptimeDays,
} from '../api/promql'

// SystemGraphsPage renders "small multiples": one chosen metric
// repeated once per system, on a single page. Operator picks the
// metric from the dropdown; every panel shares the global
// TimeRangeContext so the picker controls all of them together.
// Click a panel's system-name title to drill into that system's
// detail page.
//
// Systems without an installed exporter render a panel that says
// "No samples in the selected window." — same empty state the
// individual MetricsPanel uses. We don't pre-filter by exporter
// status because it would require one /api/systems/{id}/exporters
// fetch per system on every mount; the empty-state cue is honest.
type MetricChoice = {
  id: string
  label: string
  promql: (systemId: string) => string
  yDomain?: [number, number]
  seriesLabel?: (m: Record<string, string>) => string
}

const METRIC_CHOICES: ReadonlyArray<MetricChoice> = [
  {
    id: 'load1',
    label: 'Load (1m)',
    promql: (id) => `node_load1{system_id="${id}"}`,
  },
  {
    id: 'cpu-busy',
    label: 'CPU busy (%)',
    promql: (id) => cpuBusyPct(id),
    yDomain: [0, 100],
  },
  {
    id: 'cpu-iowait',
    label: 'CPU iowait (%)',
    promql: (id) =>
      `avg(rate(node_cpu_seconds_total{system_id="${id}",mode="iowait"}[5m])) * 100`,
    yDomain: [0, 100],
  },
  {
    id: 'mem-used',
    label: 'Memory used (%)',
    promql: (id) => memUsedPct(`{system_id="${id}"}`),
    yDomain: [0, 100],
  },
  {
    id: 'mem-avail',
    label: 'Memory available (bytes)',
    promql: (id) => memAvailBytes(`{system_id="${id}"}`),
  },
  {
    id: 'swap-used',
    label: 'Swap used (%)',
    promql: (id) =>
      `(node_memory_SwapTotal_bytes{system_id="${id}"} - node_memory_SwapFree_bytes{system_id="${id}"}) / node_memory_SwapTotal_bytes{system_id="${id}"} * 100`,
    yDomain: [0, 100],
  },
  {
    id: 'network-io',
    label: 'Network IO (bytes/sec)',
    promql: (id) => netIoBidi(id),
    seriesLabel: (m) => (m.direction === 'in' ? 'In' : 'Out'),
  },
  {
    id: 'tcp-conns',
    label: 'TCP connections (established)',
    promql: (id) => tcpEstablished(id),
  },
  {
    id: 'disk-io',
    label: 'Disk IO (bytes/sec)',
    promql: (id) => diskIoBytesBidi(id),
    seriesLabel: (m) => (m.direction === 'read' ? 'Read' : 'Write'),
  },
  {
    id: 'disk-iops',
    label: 'Disk IOPS',
    promql: (id) => diskIopsBidi(id),
    seriesLabel: (m) => (m.direction === 'read' ? 'Read' : 'Write'),
  },
  {
    id: 'fs-usage',
    label: 'Filesystem usage (%)',
    promql: (id) => fsUsedPctPerMount(id),
    yDomain: [0, 100],
    seriesLabel: formatMountLabel,
  },
  {
    id: 'fds',
    label: 'Open file descriptors',
    promql: (id) => `node_filefd_allocated{system_id="${id}"}`,
  },
  {
    id: 'processes',
    label: 'Processes',
    promql: (id) =>
      `label_replace(node_procs_running{system_id="${id}"}, "state", "running", "", "") or label_replace(node_procs_blocked{system_id="${id}"}, "state", "blocked", "", "")`,
    seriesLabel: (m) => (m.state === 'running' ? 'Running' : 'Blocked'),
  },
  {
    id: 'uptime',
    label: 'Uptime (days)',
    promql: (id) => uptimeDays(id),
  },
]

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; systems: System[]; groups: Group[] }
  | { kind: 'error'; message: string }

const ALL_GROUPS = '__all__'

export default function SystemGraphsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [metricId, setMetricId] = useState<string>(METRIC_CHOICES[0].id)
  const [groupId, setGroupId] = useState<string>(ALL_GROUPS)
  const [metricOpen, setMetricOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  // Set of system_ids that Prometheus is scraping. null = the up{}
  // probe failed or hasn't completed; in that case we don't filter so
  // a Prometheus outage doesn't make the page look empty.
  const [monitoredIds, setMonitoredIds] = useState<Set<string> | null>(null)

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
    void (async () => {
      try {
        const result = await query('up{job="system-wrangler-exporters"}')
        if (cancelled) return
        const ids = new Set(
          result
            .map((v) => v.metric.system_id)
            .filter((id): id is string => typeof id === 'string' && id !== ''),
        )
        setMonitoredIds(ids)
      } catch {
        if (cancelled) return
        setMonitoredIds(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const metric = useMemo(
    () => METRIC_CHOICES.find((m) => m.id === metricId) ?? METRIC_CHOICES[0],
    [metricId],
  )

  const visibleSystems = useMemo(() => {
    if (state.kind !== 'ready') return []
    let list = state.systems
    if (groupId !== ALL_GROUPS) {
      list = list.filter((s) => s.groupId === groupId)
    }
    if (monitoredIds !== null) {
      list = list.filter((s) => monitoredIds.has(s.id))
    }
    return list
  }, [state, groupId, monitoredIds])

  const selectedGroupLabel =
    groupId === ALL_GROUPS
      ? 'All systems'
      : state.kind === 'ready'
        ? (state.groups.find((g) => g.id === groupId)?.name ?? 'All systems')
        : 'All systems'

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1">System graphs</Title>
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
          <TimeRangeProvider defaultSeconds={DEFAULT_PRESET_SECONDS}>
            <StackItem>
              <Flex
                alignItems={{ default: 'alignItemsCenter' }}
                spaceItems={{ default: 'spaceItemsLg' }}
              >
                <FlexItem>
                  <span style={{ marginRight: '0.5rem' }}>Metric:</span>
                  <Select
                    isOpen={metricOpen}
                    selected={metricId}
                    onSelect={(_, value) => {
                      setMetricId(String(value))
                      setMetricOpen(false)
                    }}
                    onOpenChange={(o) => setMetricOpen(o)}
                    toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                      <MenuToggle
                        ref={toggleRef}
                        onClick={() => setMetricOpen((v) => !v)}
                        isExpanded={metricOpen}
                        aria-label="Metric"
                      >
                        {metric.label}
                      </MenuToggle>
                    )}
                  >
                    <SelectList>
                      {METRIC_CHOICES.map((m) => (
                        <SelectOption key={m.id} value={m.id}>
                          {m.label}
                        </SelectOption>
                      ))}
                    </SelectList>
                  </Select>
                </FlexItem>
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
                      <SelectOption value={ALL_GROUPS}>
                        All systems
                      </SelectOption>
                      {state.groups.map((g) => (
                        <SelectOption key={g.id} value={g.id}>
                          {g.name}
                        </SelectOption>
                      ))}
                    </SelectList>
                  </Select>
                </FlexItem>
                <FlexItem>
                  <TimeRangePicker defaultSeconds={DEFAULT_PRESET_SECONDS} />
                </FlexItem>
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
                    ) : monitoredIds !== null &&
                      state.systems.every((s) => !monitoredIds.has(s.id)) ? (
                      <>
                        No systems have monitoring enabled yet. Install an
                        exporter from the Monitoring tab on a system's detail
                        page.
                      </>
                    ) : (
                      <>
                        No systems match the current group filter (or none in
                        the group have monitoring enabled).
                      </>
                    )}
                  </CardBody>
                </Card>
              </StackItem>
            ) : (
              <StackItem>
                <Grid hasGutter>
                  {visibleSystems.map((sys) => (
                    <GridItem key={sys.id} md={6} sm={12}>
                      <MetricsPanel
                        title={
                          <Link to={`/systems/${sys.id}`}>{sys.name}</Link>
                        }
                        promql={metric.promql(sys.id)}
                        yDomain={metric.yDomain}
                        seriesLabel={metric.seriesLabel}
                      />
                    </GridItem>
                  ))}
                </Grid>
              </StackItem>
            )}
          </TimeRangeProvider>
        )}
      </Stack>
    </PageSection>
  )
}
