// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Bullseye,
  Button,
  Label,
  PageSection,
  Spinner,
  Switch,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  deleteSchedule,
  listSchedules,
  runScheduleNow,
  type Schedule,
  updateSchedule,
} from '../api/schedules'
import { ApiError } from '../api/systems'
import ScheduleModal from '../components/ScheduleModal'
import ScheduleRunsModal from '../components/ScheduleRunsModal'

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; schedules: Schedule[] }

// SchedulesPage is the Administration → Schedules view. It lists
// every schedule visible to the caller, offers Add / Edit / Delete /
// Run-now / View history per row, and renders a per-row enabled
// switch that flips without leaving the table. RBAC is enforced
// server-side; the page itself stays role-agnostic and surfaces
// 403s from the API as inline errors.
export default function SchedulesPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [edit, setEdit] = useState<Schedule | 'new' | null>(null)
  const [runsFor, setRunsFor] = useState<Schedule | null>(null)

  const refresh = useCallback(() => {
    listSchedules()
      .then((schedules) => setState({ kind: 'ready', schedules }))
      .catch((err) =>
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleDelete = async (sch: Schedule) => {
    setActionError(null)
    try {
      await deleteSchedule(sch.id)
      refresh()
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  const handleRunNow = async (sch: Schedule) => {
    setActionError(null)
    try {
      await runScheduleNow(sch.id)
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  const handleToggleEnabled = async (sch: Schedule, enabled: boolean) => {
    setActionError(null)
    try {
      // Preserve every other field — the server requires a full
      // ScheduleInput on PUT, so we ship the existing row with the
      // enabled flag flipped.
      await updateSchedule(sch.id, {
        name: sch.name,
        cronExpr: sch.cronExpr,
        timezone: sch.timezone,
        runCheck: sch.runCheck,
        runApply: sch.runApply,
        rebootAfterApply: sch.rebootAfterApply,
        targetKind: sch.targetKind,
        targetValue: sch.targetValue,
        enabled,
      })
      refresh()
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  return (
    <PageSection>
      <Title headingLevel="h1">Schedules</Title>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={() => setEdit('new')}>
              Add schedule
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {actionError && (
        <Alert
          variant="danger"
          title="Action failed"
          isInline
          actionClose={
            <Button variant="plain" onClick={() => setActionError(null)} aria-label="Dismiss error">
              ×
            </Button>
          }
        >
          {actionError}
        </Alert>
      )}
      {state.kind === 'loading' && (
        <Bullseye>
          <Spinner aria-label="Loading schedules" />
        </Bullseye>
      )}
      {state.kind === 'error' && (
        <Alert variant="danger" title="Could not load schedules" isInline>
          {state.message}
        </Alert>
      )}
      {state.kind === 'ready' && state.schedules.length === 0 && (
        <Alert variant="info" title="No schedules yet" isInline>
          Click <strong>Add schedule</strong> to create the first one.
        </Alert>
      )}
      {state.kind === 'ready' && state.schedules.length > 0 && (
        <Table aria-label="Schedules">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Cron</Th>
              <Th>Target</Th>
              <Th>Actions</Th>
              <Th>Enabled</Th>
              <Th>Last run</Th>
              <Th>Next run</Th>
              <Th screenReaderText="Row actions" />
            </Tr>
          </Thead>
          <Tbody>
            {state.schedules.map((s) => (
              <Tr key={s.id}>
                <Td dataLabel="Name">{s.name}</Td>
                <Td dataLabel="Cron">
                  <code>{s.cronExpr}</code>
                  {s.timezone && s.timezone !== 'UTC' && (
                    <Badge style={{ marginInlineStart: '0.5rem' }}>
                      {s.timezone}
                    </Badge>
                  )}
                </Td>
                <Td dataLabel="Target">{describeTarget(s)}</Td>
                <Td dataLabel="Actions">
                  {s.runCheck && <Label color="blue" style={{ marginRight: '0.25rem' }}>check</Label>}
                  {s.runApply && <Label color="purple" style={{ marginRight: '0.25rem' }}>apply</Label>}
                  {s.rebootAfterApply && <Label color="orange">reboot</Label>}
                </Td>
                <Td dataLabel="Enabled">
                  <Switch
                    id={`schedule-${s.id}-enabled`}
                    aria-label={`Toggle ${s.name}`}
                    isChecked={s.enabled}
                    onChange={(_, v) => void handleToggleEnabled(s, v)}
                  />
                </Td>
                <Td dataLabel="Last run">{describeRunOutcome(s)}</Td>
                <Td dataLabel="Next run">{formatTimestamp(s.nextRunAt)}</Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      { title: 'Edit', onClick: () => setEdit(s) },
                      { title: 'Run now', onClick: () => void handleRunNow(s) },
                      { title: 'View runs', onClick: () => setRunsFor(s) },
                      { isSeparator: true },
                      {
                        title: 'Delete',
                        onClick: () => {
                          if (window.confirm(`Delete schedule ${s.name}?`)) {
                            void handleDelete(s)
                          }
                        },
                      },
                    ]}
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      <ScheduleModal
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null)
          refresh()
        }}
      />
      <ScheduleRunsModal
        schedule={runsFor}
        onClose={() => setRunsFor(null)}
      />
    </PageSection>
  )
}

function describeTarget(s: Schedule): React.ReactNode {
  switch (s.targetKind) {
    case 'global':
      return <em>every system</em>
    case 'group':
      return (
        <>
          group <code>{s.targetValue}</code>
        </>
      )
    case 'systems': {
      let count = 0
      try {
        const ids = JSON.parse(s.targetValue) as string[]
        count = ids.length
      } catch {
        // ignore — table cell falls back to "systems list"
      }
      return `${count} system${count === 1 ? '' : 's'}`
    }
    case 'selector':
      return (
        <>
          selector <code>{s.targetValue}</code>
        </>
      )
  }
}

function describeRunOutcome(s: Schedule): React.ReactNode {
  if (!s.lastRunAt) return <em>never</em>
  return (
    <>
      {formatTimestamp(s.lastRunAt)}
      {s.lastStatus && (
        <Label
          isCompact
          color={statusColor(s.lastStatus)}
          style={{ marginInlineStart: '0.5rem' }}
        >
          {s.lastStatus}
        </Label>
      )}
    </>
  )
}

function statusColor(
  status: NonNullable<Schedule['lastStatus']>,
): 'blue' | 'green' | 'orange' | 'red' {
  switch (status) {
    case 'success':
      return 'green'
    case 'partial':
      return 'orange'
    case 'failed':
      return 'red'
    default:
      return 'blue'
  }
}

function formatTimestamp(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function asMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}
