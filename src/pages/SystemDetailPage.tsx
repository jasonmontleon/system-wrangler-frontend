// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardExpandableContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  ExpandableSection,
  Label,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  Tab,
  TabTitleText,
  Tabs,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons'
import { Link, useParams } from 'react-router-dom'
import { ApiError, getSystem, type System } from '../api/systems'
import {
  applyUpdater,
  checkUpdater,
  inspectSystem,
  listSystemUpdaters,
  listUpdaterRuns,
  setUpdaterEnabled,
  type SystemUpdater,
  type UpdaterRun,
} from '../api/updaters'
import {
  listExporterRuns,
  type ExporterRun,
} from '../api/exporters'
import {
  canAdminGroup,
  isGlobalAdmin,
  isGlobalOperator,
  roleOnGroup,
  useScope,
} from '../hooks/useScope'
import MonitoringTabContent from '../components/MonitoringTabContent'
import PlatformCard from '../components/PlatformCard'
import SystemCredentialsSection from '../components/SystemCredentialsSection'
import SystemSparklinesRow from '../components/SystemSparklinesRow'
import { useEventStream } from '../hooks/useEventStream'

// UnifiedRun is the tagged union the Recent runs card consumes. The
// discriminant keeps the original Run types intact at the API
// boundary; merging happens client-side in refresh() so a 500 from
// either substrate could be tolerated if the operator wants to add
// that later.
export type UnifiedRun =
  | ({ substrate: 'updater' } & UpdaterRun)
  | ({ substrate: 'exporter' } & ExporterRun)

type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      system: System
      updaters: SystemUpdater[]
      runs: UnifiedRun[]
    }
  | { kind: 'error'; message: string }

// SystemDetailPage is the per-system surface, lives at /systems/:systemId.
// Mirrors GroupDetailPage's Members/Roles/Credentials tab pattern.
//
// Layout:
//   - Breadcrumb + title + status (always visible)
//   - Action error alert (always visible — the originating click might
//     have been on a different tab than the operator's current view)
//   - Tabs:
//       Overview   — top-right Check + Update toolbar, SystemInfoCard,
//                    AvailableUpdatesCard, RunsCard.
//       Connection — PlatformCard, then SystemCredentialsSection
//                    (Effective + HostKeys + slot editor + Test
//                    connection), gated to roles that can manage
//                    credentials.
//       Updaters   — top-right Inspect toolbar, UpdatersCard
//                    (enable/disable per registered updater).
type TabKey = 'overview' | 'connection' | 'updaters' | 'monitoring'

export default function SystemDetailPage() {
  const { systemId = '' } = useParams<{ systemId: string }>()
  const { state: scopeState } = useScope()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const refresh = useCallback(async () => {
    if (!systemId) {
      setState({ kind: 'error', message: 'No system id in URL' })
      return
    }
    // Only flip to the loading-spinner screen when we don't already
    // have data. Subsequent refreshes (event-driven or post-click)
    // update in place to avoid blanking the page mid-interaction.
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }))
    try {
      const [system, updaters, updaterRuns, exporterRuns] = await Promise.all([
        getSystem(systemId),
        listSystemUpdaters(systemId),
        listUpdaterRuns(systemId, 25),
        listExporterRuns(systemId, 25),
      ])
      const runs: UnifiedRun[] = [
        ...updaterRuns.map((r) => ({ substrate: 'updater' as const, ...r })),
        ...exporterRuns.map((r) => ({ substrate: 'exporter' as const, ...r })),
      ].sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      setState({ kind: 'ready', system, updaters, runs })
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

  // Subscribe to `systems.changed` so a run that ends in another tab
  // (or against another system) flips this page's running flag and
  // re-enables the action buttons without a manual reload. The 200ms
  // debounce matches SystemsPage so a burst of events from a fan-out
  // collapses to a single refetch.
  const refreshDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEventStream(
    useCallback(
      (event) => {
        if (event.type !== 'systems.changed') return
        if (refreshDebounce.current) clearTimeout(refreshDebounce.current)
        refreshDebounce.current = setTimeout(() => {
          void refresh()
        }, 200)
      },
      [refresh],
    ),
  )

  const canOperate = (sys: System): boolean => {
    if (isGlobalOperator(scopeState)) return true
    if (!sys.groupId) return false
    const r = roleOnGroup(scopeState, sys.groupId)
    return r === 'admin' || r === 'operator'
  }

  // canManageCreds mirrors SystemsPage's gate: Global Admin can manage
  // any system's credentials; Group Admin only systems in their group.
  // Ungrouped systems are reachable only to Global Admin.
  const canManageCreds = (sys: System): boolean => {
    if (isGlobalAdmin(scopeState)) return true
    if (!sys.groupId) return false
    return canAdminGroup(scopeState, sys.groupId)
  }

  // canRead is currently true whenever the page renders — the API
  // 404s a hidden system before this point — but isGlobalAdmin
  // would let an auditor toggle enable, which we don't want. Keep
  // canOperate as the gate for the checkboxes and action buttons.
  const operateAllowed = state.kind === 'ready' && canOperate(state.system)

  const onInspect = async () => {
    if (state.kind !== 'ready') return
    setActionError(null)
    setBusy('inspect')
    try {
      await inspectSystem(state.system.id)
      await refresh()
    } catch (err) {
      setActionError(extractActionError(err))
    } finally {
      setBusy(null)
    }
  }

  const fanOut = async (
    label: 'check' | 'apply',
    runOne: (updaterID: string) => Promise<unknown>,
  ) => {
    if (state.kind !== 'ready') return
    const targets = state.updaters.filter((u) => u.installed && u.enabled)
    if (targets.length === 0) {
      setActionError(
        `No enabled updaters on this system. Toggle one in the Enabled updaters card, or run Inspect first.`,
      )
      return
    }
    setActionError(null)
    setBusy(label)
    const errors: string[] = []
    for (const u of targets) {
      try {
        await runOne(u.updaterId)
        // Mirror fanOutOnSystem: re-Check after a successful Apply so
        // the pending list reflects the post-update state. Apply runs
        // don't refresh pending_packages on the backend; only Check
        // does. Failures here are swallowed — the apply itself
        // succeeded and a missed refresh is cosmetic.
        if (label === 'apply') {
          try {
            await checkUpdater(systemId, u.updaterId)
          } catch {
            // intentionally ignored
          }
        }
      } catch (err) {
        errors.push(`${u.updaterId}: ${extractActionError(err)}`)
      }
    }
    setBusy(null)
    await refresh()
    if (errors.length > 0) {
      setActionError(errors.join('\n'))
    }
  }

  const onCheck = () => fanOut('check', (id) => checkUpdater(systemId, id))
  const onApply = () => fanOut('apply', (id) => applyUpdater(systemId, id))

  // activeKind is the action whose button should show its
  // in-progress label ("Checking…" / "Updating…" / "Inspecting…").
  // Locally driven runs use `busy` directly. Remote runs (started in
  // another tab and surfaced by system.running) read the kind off
  // the most recent in-flight row in state.runs so the same button
  // animates the same way regardless of origin. Toggle-only busy
  // states (`toggle:<id>`) deliberately don't propagate — they don't
  // start a run.
  let activeKind: 'check' | 'apply' | 'inspect' | null = null
  if (busy === 'check' || busy === 'apply' || busy === 'inspect') {
    activeKind = busy
  } else if (state.kind === 'ready' && state.system.running) {
    // Only an in-flight *updater* run animates the Check/Update/Inspect
    // buttons. Exporter runs surface their busy state on the Monitoring
    // tab; widening this branch to the union would flicker the wrong
    // labels when an install is mid-flight.
    const inFlight = state.runs.find(
      (r) => r.substrate === 'updater' && !r.finishedAt,
    )
    if (inFlight && inFlight.substrate === 'updater') {
      activeKind = inFlight.kind
    }
  }

  const onToggle = async (u: SystemUpdater, next: boolean) => {
    setActionError(null)
    setBusy(`toggle:${u.updaterId}`)
    try {
      await setUpdaterEnabled(systemId, u.updaterId, next)
      await refresh()
    } catch (err) {
      setActionError(extractActionError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Breadcrumb>
            <BreadcrumbItem to="/systems" component={(props) => <Link to="/systems" {...props} />}>
              Systems
            </BreadcrumbItem>
            <BreadcrumbItem isActive>
              {state.kind === 'ready' ? state.system.name : systemId}
            </BreadcrumbItem>
          </Breadcrumb>
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
            <Alert variant="danger" title="Failed to load system" isInline>
              {state.message}
            </Alert>
          </StackItem>
        )}
        {state.kind === 'ready' && (
          <>
            <StackItem>
              <Title headingLevel="h1">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <SystemHealthIcon
                    status={state.system.status}
                    pendingUpdates={state.system.pendingUpdates}
                    lastRunFailed={state.system.lastRunFailed}
                  />
                  {state.system.name}
                </span>
              </Title>
              <small>
                {state.system.hostname} ·{' '}
                <StatusBadge status={state.system.status} />
              </small>
            </StackItem>
            <StackItem>
              <SystemSparklinesRow
                systemId={state.system.id}
                onClick={() => setActiveTab('monitoring')}
              />
            </StackItem>
            <StackItem>
              <Tabs
                activeKey={activeTab}
                onSelect={(_, key) => setActiveTab(key as TabKey)}
                aria-label={`${state.system.name} tabs`}
              >
                <Tab eventKey="overview" title={<TabTitleText>Overview</TabTitleText>} />
                <Tab eventKey="connection" title={<TabTitleText>Connection</TabTitleText>} />
                <Tab eventKey="updaters" title={<TabTitleText>Updaters</TabTitleText>} />
                <Tab eventKey="monitoring" title={<TabTitleText>Monitoring</TabTitleText>} />
              </Tabs>
            </StackItem>
            {actionError && (
              <StackItem>
                <Alert variant="danger" title="Action failed" isInline>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{actionError}</pre>
                </Alert>
              </StackItem>
            )}
            {activeTab === 'overview' && (
              <>
                <StackItem>
                  <Toolbar>
                    <ToolbarContent>
                      <ToolbarItem align={{ default: 'alignEnd' }}>
                        <Button
                          variant="secondary"
                          isDisabled={!operateAllowed || busy !== null || !!state.system.running}
                          onClick={() => void onCheck()}
                        >
                          {activeKind === 'check' ? 'Checking…' : 'Check'}
                        </Button>
                      </ToolbarItem>
                      <ToolbarItem>
                        <Button
                          variant="primary"
                          isDisabled={!operateAllowed || busy !== null || !!state.system.running}
                          onClick={() => void onApply()}
                        >
                          {activeKind === 'apply' ? 'Updating…' : 'Update'}
                        </Button>
                      </ToolbarItem>
                    </ToolbarContent>
                  </Toolbar>
                </StackItem>
                <StackItem>
                  <SystemInfoCard system={state.system} />
                </StackItem>
                <StackItem>
                  <AvailableUpdatesCard updaters={state.updaters} />
                </StackItem>
                <StackItem>
                  <RunsCard runs={state.runs} />
                </StackItem>
              </>
            )}
            {activeTab === 'connection' && (
              <>
                <StackItem>
                  <PlatformCard
                    system={state.system}
                    canEdit={operateAllowed}
                    onChange={refresh}
                  />
                </StackItem>
                {canManageCreds(state.system) && (
                  <StackItem>
                    <SystemCredentialsSection system={state.system} />
                  </StackItem>
                )}
              </>
            )}
            {activeTab === 'updaters' && (
              <>
                <StackItem>
                  <Toolbar>
                    <ToolbarContent>
                      <ToolbarItem align={{ default: 'alignEnd' }}>
                        <Button
                          variant="secondary"
                          isDisabled={!operateAllowed || busy !== null || !!state.system.running}
                          onClick={() => void onInspect()}
                        >
                          {activeKind === 'inspect' ? 'Inspecting…' : 'Inspect now'}
                        </Button>
                      </ToolbarItem>
                    </ToolbarContent>
                  </Toolbar>
                </StackItem>
                <StackItem>
                  <UpdatersCard
                    updaters={state.updaters}
                    canOperate={operateAllowed}
                    busy={busy}
                    onToggle={onToggle}
                  />
                </StackItem>
              </>
            )}
            {activeTab === 'monitoring' && (
              <StackItem>
                <MonitoringTabContent
                  systemId={state.system.id}
                  canOperate={operateAllowed}
                />
              </StackItem>
            )}
          </>
        )}
      </Stack>
    </PageSection>
  )
}

function StatusBadge({ status }: { status: System['status'] }) {
  const cfg: Record<System['status'], { color: 'green' | 'red' | 'grey'; text: string }> = {
    reachable: { color: 'green', text: 'Reachable' },
    unreachable: { color: 'red', text: 'Unreachable' },
    unprobed: { color: 'grey', text: 'Unprobed' },
  }
  const c = cfg[status]
  return <Label color={c.color}>{c.text}</Label>
}

// SystemHealthIcon mirrors SystemsPage's row glyph on the detail
// header. Precedence (most-actionable wins): unreachable → red,
// last-run failed → red, reachable+pending → yellow, reachable+0 →
// green, unprobed → no icon.
function SystemHealthIcon({
  status,
  pendingUpdates,
  lastRunFailed,
}: {
  status: System['status']
  pendingUpdates: number | undefined
  lastRunFailed: boolean | undefined
}) {
  if (status === 'unreachable') {
    return (
      <TimesCircleIcon
        aria-label="Unreachable"
        color="var(--pf-t--global--icon--color--status--danger--default)"
      />
    )
  }
  if (lastRunFailed) {
    return (
      <TimesCircleIcon
        aria-label="Last run failed"
        color="var(--pf-t--global--icon--color--status--danger--default)"
      />
    )
  }
  if (status === 'reachable' && pendingUpdates !== undefined) {
    if (pendingUpdates === 0) {
      return (
        <CheckCircleIcon
          aria-label="Up to date"
          color="var(--pf-t--global--icon--color--status--success--default)"
        />
      )
    }
    return (
      <ExclamationTriangleIcon
        aria-label="Updates available"
        color="var(--pf-t--global--icon--color--status--warning--default)"
      />
    )
  }
  return null
}

// HealthSummary derives the "Needs Attention / Updates Available /
// System Healthy" line shown on the System information card. Same
// precedence as the row glyph; an unprobed system returns null
// because we have no probe data to verdict on.
type HealthSummary =
  | { kind: 'attention'; reason: string }
  | { kind: 'updates' }
  | { kind: 'healthy' }
  | null

function healthSummaryFor(system: System): HealthSummary {
  if (system.status === 'unreachable') {
    return { kind: 'attention', reason: 'Unreachable' }
  }
  if (system.lastRunFailed) {
    return {
      kind: 'attention',
      reason: system.lastRunReason
        ? `Last run failed (${system.lastRunReason})`
        : 'Last run failed',
    }
  }
  if (system.status === 'reachable' && system.pendingUpdates !== undefined) {
    return system.pendingUpdates === 0
      ? { kind: 'healthy' }
      : { kind: 'updates' }
  }
  return null
}

function HealthSummaryLine({ system }: { system: System }) {
  const summary = healthSummaryFor(system)
  if (!summary) return null
  if (summary.kind === 'attention') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <TimesCircleIcon
          aria-hidden
          color="var(--pf-t--global--icon--color--status--danger--default)"
        />
        Needs Attention: {summary.reason}
      </span>
    )
  }
  if (summary.kind === 'updates') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <ExclamationTriangleIcon
          aria-hidden
          color="var(--pf-t--global--icon--color--status--warning--default)"
        />
        Updates Available
      </span>
    )
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <CheckCircleIcon
        aria-hidden
        color="var(--pf-t--global--icon--color--status--success--default)"
      />
      System Healthy
    </span>
  )
}

function UpdatersCard({
  updaters,
  canOperate,
  busy,
  onToggle,
}: {
  updaters: SystemUpdater[]
  canOperate: boolean
  busy: string | null
  onToggle: (u: SystemUpdater, next: boolean) => void
}) {
  return (
    <Card>
      <CardTitle>Enabled updaters</CardTitle>
      <CardBody>
        {updaters.length === 0 ? (
          <p>No updaters are registered. Add a custom one from the Updaters admin page.</p>
        ) : (
          <Table aria-label="Per-system updaters" variant="compact">
            <Thead>
              <Tr>
                <Th>Updater</Th>
                <Th>Source</Th>
                <Th>Detected</Th>
                <Th>Enabled</Th>
                <Th>Last seen</Th>
              </Tr>
            </Thead>
            <Tbody>
              {updaters.map((u) => (
                <Tr key={u.updaterId}>
                  <Td>
                    <Stack>
                      <StackItem>
                        {u.displayName}
                        {u.checkOnly && (
                          <>
                            {' '}
                            <Label color="orange" isCompact>
                              Check-only
                            </Label>
                          </>
                        )}
                      </StackItem>
                      <StackItem>
                        <small>{u.updaterId}</small>
                      </StackItem>
                    </Stack>
                  </Td>
                  <Td>
                    <Label color={u.source === 'builtin' ? 'blue' : 'purple'}>{u.source}</Label>
                  </Td>
                  <Td>{u.installed ? 'Yes' : 'No'}</Td>
                  <Td>
                    <Checkbox
                      id={`enabled-${u.updaterId}`}
                      isChecked={u.enabled && u.installed}
                      isDisabled={!canOperate || !u.installed || busy === `toggle:${u.updaterId}`}
                      onChange={(_e, checked) => onToggle(u, checked)}
                      aria-label={`Enable ${u.displayName}`}
                    />
                  </Td>
                  <Td>{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '—'}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  )
}

// AvailableUpdatesCard surfaces the per-updater pending list pulled
// from the latest check run. Empty list / never-checked rows are
// hidden — the card only renders updaters with a non-zero pending
// count so an operator can scan to "what's actionable" without
// scrolling past zero-rows. The whole card is collapsible so a
// busy detail page can be condensed without losing the section.
function AvailableUpdatesCard({ updaters }: { updaters: SystemUpdater[] }) {
  const [isExpanded, setExpanded] = useState(true)
  const rows = updaters.filter(
    (u) => u.installed && (u.pendingPackages?.length ?? 0) > 0,
  )
  return (
    <Card id="available-updates-card" isExpanded={isExpanded}>
      <CardHeader
        onExpand={() => setExpanded((v) => !v)}
        toggleButtonProps={{
          'aria-label': 'Toggle available updates',
          'aria-expanded': isExpanded,
        }}
      >
        <CardTitle>Available updates</CardTitle>
      </CardHeader>
      <CardExpandableContent>
        <CardBody>
          {rows.length === 0 ? (
            <p>
              No pending updates known. Run Check to refresh the list, or
              wait for the next scheduled check.
            </p>
          ) : (
            <Table aria-label="Available updates" variant="compact">
              <Thead>
                <Tr>
                  <Th>Updater</Th>
                  <Th>Pending</Th>
                  <Th>As of</Th>
                  <Th>Packages</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((u) => (
                  <Tr key={u.updaterId}>
                    <Td>
                      <Stack>
                        <StackItem>
                          {u.displayName}
                          {u.checkOnly && (
                            <>
                              {' '}
                              <Label color="orange" isCompact>
                                Check-only
                              </Label>
                            </>
                          )}
                        </StackItem>
                        <StackItem>
                          <small>{u.updaterId}</small>
                        </StackItem>
                      </Stack>
                    </Td>
                    <Td>{u.pendingPackages.length}</Td>
                    <Td>
                      {u.lastSeenAt
                        ? new Date(u.lastSeenAt).toLocaleString()
                        : '—'}
                    </Td>
                    <Td>
                      <ExpandableSection
                        toggleText={`Show ${u.pendingPackages.length} package${u.pendingPackages.length === 1 ? '' : 's'}`}
                      >
                        <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                          {u.pendingPackages.map((p) => (
                            <li key={`${p.name}|${p.oldVersion}|${p.newVersion}`}>
                              <code>{p.name}</code>
                              {(p.oldVersion || p.newVersion) && (
                                <>
                                  {' '}
                                  <small>
                                    {p.oldVersion || '—'} → {p.newVersion || '—'}
                                  </small>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      </ExpandableSection>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </CardExpandableContent>
    </Card>
  )
}

function RunsCard({ runs }: { runs: UnifiedRun[] }) {
  const [isExpanded, setExpanded] = useState(true)
  return (
    <Card id="recent-runs-card" isExpanded={isExpanded}>
      <CardHeader
        onExpand={() => setExpanded((v) => !v)}
        toggleButtonProps={{
          'aria-label': 'Toggle recent runs',
          'aria-expanded': isExpanded,
        }}
      >
        <CardTitle>Recent runs</CardTitle>
      </CardHeader>
      <CardExpandableContent>
        <CardBody>
          {runs.length === 0 ? (
            <p>
              No runs yet. Try Inspect on the Updaters tab, or install an
              exporter from the Monitoring tab.
            </p>
          ) : (
            <Table aria-label="Recent runs" variant="compact">
              <Thead>
                <Tr>
                  <Th>Substrate</Th>
                  <Th>Kind</Th>
                  <Th>Target</Th>
                  <Th>Started</Th>
                  <Th>Exit</Th>
                  <Th>Log tail</Th>
                </Tr>
              </Thead>
              <Tbody>
                {runs.map((r) => {
                  const target =
                    r.substrate === 'updater'
                      ? (r.updaterId ?? '—')
                      : r.exporterId
                  return (
                    <Tr key={`${r.substrate}-${r.id}`}>
                      <Td>{r.substrate}</Td>
                      <Td>{r.kind}</Td>
                      <Td>{target}</Td>
                      <Td>{new Date(r.startedAt).toLocaleString()}</Td>
                      <Td>{r.exitCode ?? '…'}</Td>
                      <Td>
                        <ExpandableSection toggleText="Show">
                          <pre style={{ whiteSpace: 'pre-wrap' }}>
                            {r.logTail ?? ''}
                          </pre>
                        </ExpandableSection>
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </CardExpandableContent>
    </Card>
  )
}

function extractActionError(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return 'Another inspect / check / apply is running for this system. Wait for it to finish, then retry.'
  }
  return err instanceof Error ? err.message : String(err)
}

// SystemInfoCard surfaces the slow-moving system metadata —
// hostname, status, added-at, last probe contact — that used to
// live as columns on the Systems table. As we ingest more data
// from node_exporter (CPU, memory, OS release, kernel, etc.)
// they slot in here without further restructure.
function SystemInfoCard({ system }: { system: System }) {
  const lastSeen = formatDateOrFallback(system.lastSeen, 'Never')
  const createdAt = formatDateOrFallback(system.createdAt, '—')
  const health = healthSummaryFor(system)
  return (
    <Card>
      <CardTitle>System information</CardTitle>
      <CardBody>
        <DescriptionList isHorizontal>
          {health && (
            <DescriptionListGroup>
              <DescriptionListTerm>Health</DescriptionListTerm>
              <DescriptionListDescription>
                <HealthSummaryLine system={system} />
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}
          <DescriptionListGroup>
            <DescriptionListTerm>Hostname</DescriptionListTerm>
            <DescriptionListDescription>
              <code>{system.hostname}</code>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Status</DescriptionListTerm>
            <DescriptionListDescription>
              <StatusBadge status={system.status} />
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Last seen</DescriptionListTerm>
            <DescriptionListDescription>{lastSeen}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Added</DescriptionListTerm>
            <DescriptionListDescription>{createdAt}</DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      </CardBody>
    </Card>
  )
}

function formatDateOrFallback(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleString()
}
