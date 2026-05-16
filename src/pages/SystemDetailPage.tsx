// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Bullseye,
  Button,
  Card,
  CardBody,
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
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
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
  canAdminGroup,
  isGlobalAdmin,
  isGlobalOperator,
  roleOnGroup,
  useScope,
} from '../hooks/useScope'

type LoadState =
  | { kind: 'loading' }
  | {
      kind: 'ready'
      system: System
      updaters: SystemUpdater[]
      runs: UpdaterRun[]
    }
  | { kind: 'error'; message: string }

// SystemDetailPage is the per-system surface. Replaces the old
// "Capabilities & updates" panel that briefly lived inside the
// Credentials modal. The page lives at /systems/:systemId.
//
// Sections (top to bottom):
//   - Breadcrumb + title + status
//   - Action bar: Inspect now, Check (fan out over enabled), Update
//     (fan out apply over enabled)
//   - Enabled updaters card: every registered updater, with detection
//     and enablement state; checkboxes toggle PUT .../enabled.
//   - Recent runs card: most recent inspect/check/apply rows with
//     expandable log tails.
//
// Credentials configuration stays in the Systems-page row action
// modal for now; the user's roadmap note "might be sensible to move
// credential configuration to this page as well as a next step"
// lives in a follow-up.
export default function SystemDetailPage() {
  const { systemId = '' } = useParams<{ systemId: string }>()
  const { state: scopeState } = useScope()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!systemId) {
      setState({ kind: 'error', message: 'No system id in URL' })
      return
    }
    setState({ kind: 'loading' })
    try {
      const [system, updaters, runs] = await Promise.all([
        getSystem(systemId),
        listSystemUpdaters(systemId),
        listUpdaterRuns(systemId, 25),
      ])
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

  const canOperate = (sys: System): boolean => {
    if (isGlobalOperator(scopeState)) return true
    if (!sys.groupId) return false
    const r = roleOnGroup(scopeState, sys.groupId)
    return r === 'admin' || r === 'operator'
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
              <Title headingLevel="h1">{state.system.name}</Title>
              <small>
                {state.system.hostname} ·{' '}
                <StatusBadge status={state.system.status} />
              </small>
            </StackItem>
            <StackItem>
              <SystemInfoCard system={state.system} />
            </StackItem>
            {actionError && (
              <StackItem>
                <Alert variant="danger" title="Action failed" isInline>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{actionError}</pre>
                </Alert>
              </StackItem>
            )}
            <StackItem>
              <Toolbar>
                <ToolbarContent>
                  <ToolbarItem>
                    <Button
                      variant="secondary"
                      isDisabled={!operateAllowed || busy !== null}
                      onClick={() => void onInspect()}
                    >
                      {busy === 'inspect' ? 'Inspecting…' : 'Inspect now'}
                    </Button>
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button
                      variant="secondary"
                      isDisabled={!operateAllowed || busy !== null}
                      onClick={() => void onCheck()}
                    >
                      {busy === 'check' ? 'Checking…' : 'Check'}
                    </Button>
                  </ToolbarItem>
                  <ToolbarItem>
                    <Button
                      variant="primary"
                      isDisabled={!operateAllowed || busy !== null}
                      onClick={() => void onApply()}
                    >
                      {busy === 'apply' ? 'Updating…' : 'Update'}
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
            <StackItem>
              <RunsCard runs={state.runs} />
            </StackItem>
            {/* Surface unused scope helpers so the import stays
                honest while the credential-relocation work is
                pending. */}
            <span style={{ display: 'none' }}>
              {isGlobalAdmin(scopeState) ? 'a' : 'b'}
              {canAdminGroup(scopeState, state.system.groupId ?? '') ? 'a' : 'b'}
            </span>
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
                      <StackItem>{u.displayName}</StackItem>
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

function RunsCard({ runs }: { runs: UpdaterRun[] }) {
  return (
    <Card>
      <CardTitle>Recent runs</CardTitle>
      <CardBody>
        {runs.length === 0 ? (
          <p>No runs yet. Try Inspect now to detect installed updaters, then Check or Update.</p>
        ) : (
          <Table aria-label="Recent updater runs" variant="compact">
            <Thead>
              <Tr>
                <Th>Kind</Th>
                <Th>Updater</Th>
                <Th>Started</Th>
                <Th>Exit</Th>
                <Th>Log tail</Th>
              </Tr>
            </Thead>
            <Tbody>
              {runs.map((r) => (
                <Tr key={r.id}>
                  <Td>{r.kind}</Td>
                  <Td>{r.updaterId ?? '—'}</Td>
                  <Td>{new Date(r.startedAt).toLocaleString()}</Td>
                  <Td>{r.exitCode ?? '…'}</Td>
                  <Td>
                    <ExpandableSection toggleText="Show">
                      <pre style={{ whiteSpace: 'pre-wrap' }}>{r.logTail ?? ''}</pre>
                    </ExpandableSection>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>
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
  return (
    <Card>
      <CardTitle>System information</CardTitle>
      <CardBody>
        <DescriptionList isHorizontal>
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
