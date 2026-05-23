// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Grid,
  GridItem,
  Label,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  installExporter,
  listSystemExporters,
  removeExporter,
  statusExporter,
  type SystemExporter,
  type SystemExportersResponse,
} from '../api/exporters'
import { ApiError } from '../api/systems'
import MetricsPanel from './MetricsPanel'
import TimeRangePicker from './TimeRangePicker'
import { TimeRangeProvider } from './TimeRangeProvider'
import { DEFAULT_PRESET_SECONDS } from '../hooks/useTimeRange'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: SystemExportersResponse }
  | { kind: 'error'; message: string }

// MonitoringTabContent renders the per-system Monitoring tab on the
// system detail page. Lists every registered exporter installer with
// the system's three-state availability, install state, and the
// Install / Reinstall / Status / Remove actions. The full design
// lives in research/exporter-deployment.md "UI shape".
export default function MonitoringTabContent({
  systemId,
  canOperate,
}: {
  systemId: string
  canOperate: boolean
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!systemId) {
      setState({ kind: 'error', message: 'No system id' })
      return
    }
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }))
    try {
      const data = await listSystemExporters(systemId)
      setState({ kind: 'ready', data })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [systemId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runOne = async (
    action: 'install' | 'status' | 'remove',
    exporterId: string,
    runner: (sys: string, id: string) => Promise<unknown>,
  ) => {
    setActionError(null)
    setBusy(`${action}:${exporterId}`)
    try {
      await runner(systemId, exporterId)
      await refresh()
    } catch (err) {
      setActionError(extractActionError(err))
    } finally {
      setBusy(null)
    }
  }

  if (state.kind === 'loading') {
    return (
      <Bullseye>
        <Spinner size="md" />
      </Bullseye>
    )
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="danger" title="Failed to load exporters" isInline>
        {state.message}
      </Alert>
    )
  }

  const { data } = state
  const hasInspected = data.detectedPkgManagers.length > 0
  const matching = data.exporters.filter(
    (e) => e.availability === 'available' || e.installed,
  )
  const others = data.exporters.filter(
    (e) => !matching.includes(e),
  )

  return (
    <Stack hasGutter>
      {actionError && (
        <StackItem>
          <Alert variant="danger" title="Action failed" isInline>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{actionError}</pre>
          </Alert>
        </StackItem>
      )}
      <StackItem>
        <Card>
          <CardTitle>Monitoring settings</CardTitle>
          <CardBody>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Scrape mode</DescriptionListTerm>
                <DescriptionListDescription>
                  <code>{data.scrapeMode}</code>
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Detected package managers</DescriptionListTerm>
                <DescriptionListDescription>
                  {data.detectedPkgManagers.length === 0
                    ? '— (run Inspect on the Updaters tab first)'
                    : data.detectedPkgManagers.map((m) => (
                        <Label key={m} isCompact style={{ marginRight: '0.25rem' }}>
                          <code>{m}</code>
                        </Label>
                      ))}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </CardBody>
        </Card>
      </StackItem>

      {!hasInspected && (
        <StackItem>
          <Alert variant="info" title="Run Inspect to see exporter options" isInline>
            System Wrangler needs to inspect this system before it can
            determine which exporter installers apply. Visit the
            Updaters tab and click <strong>Inspect now</strong>.
          </Alert>
        </StackItem>
      )}

      <StackItem>
        <Card>
          <CardTitle>Available exporters</CardTitle>
          <CardBody>
            {matching.length === 0 ? (
              <UnavailablePanel
                detected={data.detectedPkgManagers}
                hasInspected={hasInspected}
              />
            ) : (
              <ExporterTable
                rows={matching}
                canOperate={canOperate}
                busy={busy}
                onInstall={(e) => runOne('install', e.exporterId, installExporter)}
                onStatus={(e) => runOne('status', e.exporterId, statusExporter)}
                onRemove={(e) => runOne('remove', e.exporterId, removeExporter)}
              />
            )}
          </CardBody>
        </Card>
      </StackItem>

      {hasInspected && data.exporters.some((e) => e.installed) && (
        <TimeRangeProvider defaultSeconds={DEFAULT_PRESET_SECONDS}>
          <StackItem>
            <TimeRangePicker defaultSeconds={DEFAULT_PRESET_SECONDS} />
          </StackItem>
          <StackItem>
            <Grid hasGutter>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Load average (1m)"
                  promql={`node_load1{system_id="${systemId}"}`}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="CPU busy (%)"
                  promql={`100 - (avg(rate(node_cpu_seconds_total{system_id="${systemId}",mode="idle"}[5m])) * 100)`}
                  yDomain={[0, 100]}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="CPU iowait (%)"
                  promql={`avg(rate(node_cpu_seconds_total{system_id="${systemId}",mode="iowait"}[5m])) * 100`}
                  yDomain={[0, 100]}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Memory used (%)"
                  promql={`(1 - node_memory_MemAvailable_bytes{system_id="${systemId}"} / node_memory_MemTotal_bytes{system_id="${systemId}"}) * 100`}
                  yDomain={[0, 100]}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Memory available (bytes)"
                  promql={`node_memory_MemAvailable_bytes{system_id="${systemId}"}`}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Swap used (%)"
                  promql={`(node_memory_SwapTotal_bytes{system_id="${systemId}"} - node_memory_SwapFree_bytes{system_id="${systemId}"}) / node_memory_SwapTotal_bytes{system_id="${systemId}"} * 100`}
                  yDomain={[0, 100]}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Network IO (bytes/sec)"
                  promql={`label_replace(sum without(device)(rate(node_network_receive_bytes_total{system_id="${systemId}",device!~"lo|docker.*|veth.*|cni.*|br-.*|virbr.*"}[5m])), "direction", "in", "", "") or label_replace(sum without(device)(rate(node_network_transmit_bytes_total{system_id="${systemId}",device!~"lo|docker.*|veth.*|cni.*|br-.*|virbr.*"}[5m])), "direction", "out", "", "")`}
                  seriesLabel={(m) => (m.direction === 'in' ? 'In' : 'Out')}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="TCP connections (established)"
                  promql={`node_netstat_Tcp_CurrEstab{system_id="${systemId}"}`}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Disk IO (bytes/sec)"
                  promql={`label_replace(sum without(device)(rate(node_disk_read_bytes_total{system_id="${systemId}"}[5m])), "direction", "read", "", "") or label_replace(sum without(device)(rate(node_disk_written_bytes_total{system_id="${systemId}"}[5m])), "direction", "write", "", "")`}
                  seriesLabel={(m) => (m.direction === 'read' ? 'Read' : 'Write')}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Disk IOPS"
                  promql={`label_replace(sum without(device)(rate(node_disk_reads_completed_total{system_id="${systemId}"}[5m])), "direction", "read", "", "") or label_replace(sum without(device)(rate(node_disk_writes_completed_total{system_id="${systemId}"}[5m])), "direction", "write", "", "")`}
                  seriesLabel={(m) => (m.direction === 'read' ? 'Read' : 'Write')}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Filesystem usage (%)"
                  promql={`(1 - node_filesystem_avail_bytes{system_id="${systemId}",fstype!~"tmpfs|devtmpfs|squashfs|overlay|ramfs|nsfs|cgroup.*|tracefs|debugfs|fusectl|sysfs|proc|pstore|bpf|configfs|securityfs|hugetlbfs|mqueue|autofs|binfmt_misc"} / node_filesystem_size_bytes{system_id="${systemId}",fstype!~"tmpfs|devtmpfs|squashfs|overlay|ramfs|nsfs|cgroup.*|tracefs|debugfs|fusectl|sysfs|proc|pstore|bpf|configfs|securityfs|hugetlbfs|mqueue|autofs|binfmt_misc"}) * 100`}
                  yDomain={[0, 100]}
                  seriesLabel={(m) => m.mountpoint ?? ''}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Uptime (days)"
                  promql={`(time() - node_boot_time_seconds{system_id="${systemId}"}) / 86400`}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Open file descriptors"
                  promql={`node_filefd_allocated{system_id="${systemId}"}`}
                />
              </GridItem>
              <GridItem md={6} sm={12}>
                <MetricsPanel
                  title="Processes"
                  promql={`label_replace(node_procs_running{system_id="${systemId}"}, "state", "running", "", "") or label_replace(node_procs_blocked{system_id="${systemId}"}, "state", "blocked", "", "")`}
                  seriesLabel={(m) =>
                    m.state === 'running' ? 'Running' : 'Blocked'
                  }
                />
              </GridItem>
            </Grid>
          </StackItem>
        </TimeRangeProvider>
      )}

      {others.length > 0 && (
        <StackItem>
          <Card>
            <CardTitle>Other installers</CardTitle>
            <CardBody>
              <p>
                These installers target package managers not detected on
                this system. They are visible so an operator can see what
                a custom installer would compete with.
              </p>
              <ExporterTable
                rows={others}
                canOperate={false}
                busy={null}
                onInstall={() => Promise.resolve()}
                onStatus={() => Promise.resolve()}
                onRemove={() => Promise.resolve()}
              />
            </CardBody>
          </Card>
        </StackItem>
      )}
    </Stack>
  )
}

function UnavailablePanel({
  detected,
  hasInspected,
}: {
  detected: string[]
  hasInspected: boolean
}) {
  if (!hasInspected) {
    return (
      <p>
        No exporter availability yet — run Inspect on the Updaters tab
        first.
      </p>
    )
  }
  return (
    <Alert
      variant="warning"
      isInline
      title="No exporter installer available for this system"
    >
      None of the registered installers target the package managers
      detected on this system
      {detected.length > 0 && (
        <>
          {' '}
          (<code>{detected.join(', ')}</code>)
        </>
      )}
      . Add a custom installer under Administration → Exporters, or
      wait for a future release that ships a matching builtin.
    </Alert>
  )
}

function ExporterTable({
  rows,
  canOperate,
  busy,
  onInstall,
  onStatus,
  onRemove,
}: {
  rows: SystemExporter[]
  canOperate: boolean
  busy: string | null
  onInstall: (e: SystemExporter) => Promise<unknown>
  onStatus: (e: SystemExporter) => Promise<unknown>
  onRemove: (e: SystemExporter) => Promise<unknown>
}) {
  return (
    <Table aria-label="Exporters" variant="compact">
      <Thead>
        <Tr>
          <Th>Installer</Th>
          <Th>Kind</Th>
          <Th>Availability</Th>
          <Th>State</Th>
          <Th>Last status</Th>
          <Th>Actions</Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((e) => (
          <Tr key={e.exporterId}>
            <Td>
              <Stack>
                <StackItem>{e.displayName}</StackItem>
                <StackItem>
                  <small>
                    <code>{e.exporterId}</code>
                  </small>
                </StackItem>
              </Stack>
            </Td>
            <Td>{e.exporterKind}</Td>
            <Td>
              <AvailabilityBadge value={e.availability} />
            </Td>
            <Td>
              {e.installed ? (
                <StateBadge value={e.state ?? 'installed'} />
              ) : e.state === 'removed' ? (
                <Label color="grey">Removed</Label>
              ) : (
                '—'
              )}
            </Td>
            <Td>
              {e.lastStatusAt ? (
                <small>
                  {new Date(e.lastStatusAt).toLocaleString()}
                  {e.lastReason && (
                    <>
                      <br />
                      <code>{e.lastReason}</code>
                    </>
                  )}
                </small>
              ) : (
                '—'
              )}
            </Td>
            <Td>
              <ActionButtons
                exporter={e}
                canOperate={canOperate}
                busy={busy}
                onInstall={() => onInstall(e)}
                onStatus={() => onStatus(e)}
                onRemove={() => onRemove(e)}
              />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}

function ActionButtons({
  exporter,
  canOperate,
  busy,
  onInstall,
  onStatus,
  onRemove,
}: {
  exporter: SystemExporter
  canOperate: boolean
  busy: string | null
  onInstall: () => void
  onStatus: () => void
  onRemove: () => void
}) {
  const blockInstall = !canOperate || exporter.availability !== 'available' || busy !== null
  const installLabel = exporter.installed ? 'Reinstall' : 'Install'
  return (
    <>
      <Button variant="link" isDisabled={blockInstall} onClick={onInstall}>
        {busy === `install:${exporter.exporterId}` ? `${installLabel}ing…` : installLabel}
      </Button>{' '}
      <Button
        variant="link"
        isDisabled={!canOperate || !exporter.installed || busy !== null}
        onClick={onStatus}
      >
        {busy === `status:${exporter.exporterId}` ? 'Probing…' : 'Probe'}
      </Button>
      {exporter.hasRemove && exporter.installed && (
        <>
          {' '}
          <Button
            variant="link"
            isDanger
            isDisabled={!canOperate || busy !== null}
            onClick={onRemove}
          >
            {busy === `remove:${exporter.exporterId}` ? 'Removing…' : 'Remove'}
          </Button>
        </>
      )}
    </>
  )
}

function AvailabilityBadge({ value }: { value: SystemExporter['availability'] }) {
  const cfg: Record<SystemExporter['availability'], { color: 'green' | 'orange' | 'grey'; text: string }> = {
    available: { color: 'green', text: 'Available' },
    unavailable: { color: 'orange', text: 'Unavailable' },
    unknown: { color: 'grey', text: 'Unknown' },
  }
  const c = cfg[value]
  return <Label color={c.color}>{c.text}</Label>
}

function StateBadge({ value }: { value: NonNullable<SystemExporter['state']> }) {
  const cfg: Record<NonNullable<SystemExporter['state']>, { color: 'green' | 'red' | 'blue' | 'grey'; text: string }> = {
    running: { color: 'green', text: 'Running' },
    installed: { color: 'blue', text: 'Installed' },
    failed: { color: 'red', text: 'Failed' },
    removed: { color: 'grey', text: 'Removed' },
  }
  const c = cfg[value]
  return <Label color={c.color}>{c.text}</Label>
}

function extractActionError(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return 'Another inspect / check / apply / install / status / remove is running for this system. Wait for it to finish, then retry.'
  }
  return err instanceof Error ? err.message : String(err)
}
