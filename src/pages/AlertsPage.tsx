// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
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
  type ActiveAlert,
  type AlertCatalogEntry,
  type AlertMetric,
  type AlertRule,
  type Comparator,
  deleteAlertRule,
  listActiveAlerts,
  listAlertCatalog,
  listAlertRules,
  type Severity,
  updateAlertRule,
} from '../api/alerts'
import { ApiError } from '../api/systems'
import { type Group, listGroups } from '../api/groups'
import { useEventStream } from '../hooks/useEventStream'
import AlertModal from '../components/AlertModal'

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rules: AlertRule[] }

// AlertsPage is the Monitoring → Alerts view. The top half lists the
// alerts currently firing or pending (refreshed live off the
// `alerts.changed` event stream); the bottom half lists the rules that
// produce them, with Add / Edit / Delete / enable-toggle. RBAC is
// enforced server-side; the page stays role-agnostic and surfaces 403s
// as inline errors.
export default function AlertsPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [active, setActive] = useState<ActiveAlert[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [edit, setEdit] = useState<AlertRule | 'new' | null>(null)
  const [groupsById, setGroupsById] = useState<Record<string, Group>>({})
  const [catalog, setCatalog] = useState<AlertCatalogEntry[]>([])

  const refreshRules = useCallback(() => {
    listAlertRules()
      .then((rules) => setState({ kind: 'ready', rules }))
      .catch((err) =>
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }, [])

  const refreshActive = useCallback(() => {
    listActiveAlerts()
      .then(setActive)
      .catch(() => {
        // Active-alert refresh failures are non-fatal — the rules
        // table is the primary content and stays usable.
      })
  }, [])

  useEffect(() => {
    refreshRules()
    refreshActive()
    listGroups()
      .then((gs) => {
        const map: Record<string, Group> = {}
        for (const g of gs) map[g.id] = g
        setGroupsById(map)
      })
      .catch(() => setGroupsById({}))
    listAlertCatalog().then(setCatalog).catch(() => setCatalog([]))
  }, [refreshRules, refreshActive])

  // Live-refresh the active list whenever the evaluator broadcasts a
  // change. The rules table only changes on user edits, so it isn't
  // tied to the stream.
  useEventStream(
    useCallback(
      (event) => {
        if (event.type === 'alerts.changed') refreshActive()
      },
      [refreshActive],
    ),
  )

  const handleDelete = async (rule: AlertRule) => {
    setActionError(null)
    try {
      await deleteAlertRule(rule.id)
      refreshRules()
      refreshActive()
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  const handleToggleEnabled = async (rule: AlertRule, enabled: boolean) => {
    setActionError(null)
    try {
      // The server requires a full AlertRuleInput on PUT, so ship the
      // existing row with only the enabled flag flipped.
      await updateAlertRule(rule.id, {
        name: rule.name,
        description: rule.description,
        conditionKind: rule.conditionKind,
        metric: rule.metric,
        expr: rule.expr,
        comparator: rule.comparator,
        threshold: rule.threshold,
        forSeconds: rule.forSeconds,
        severity: rule.severity,
        targetKind: rule.targetKind,
        targetValue: rule.targetValue,
        enabled,
      })
      refreshRules()
      refreshActive()
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  return (
    <PageSection>
      <Title headingLevel="h1">Alerts</Title>

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

      <Title headingLevel="h2" style={{ marginTop: '1rem' }}>
        Active alerts
      </Title>
      {active.length === 0 ? (
        <Alert variant="success" title="No active alerts" isInline>
          Nothing is firing or pending right now.
        </Alert>
      ) : (
        <Table aria-label="Active alerts" variant="compact">
          <Thead>
            <Tr>
              <Th width={10}>Severity</Th>
              <Th width={15}>System</Th>
              <Th width={20}>Rule</Th>
              <Th width={10}>State</Th>
              <Th width={15}>Value</Th>
              <Th width={20}>Since</Th>
            </Tr>
          </Thead>
          <Tbody>
            {active.map((a) => (
              <Tr key={`${a.ruleId}-${a.systemId}`}>
                <Td dataLabel="Severity">
                  <Label isCompact color={severityColor(a.severity)}>
                    {severityLabel(a.severity)}
                  </Label>
                </Td>
                <Td dataLabel="System">{a.systemName || a.systemId}</Td>
                <Td dataLabel="Rule">{a.ruleName}</Td>
                <Td dataLabel="State">
                  <Label isCompact color={a.state === 'firing' ? 'red' : 'orange'}>
                    {a.state === 'firing' ? 'Firing' : 'Pending'}
                  </Label>
                </Td>
                <Td dataLabel="Value">{describeActiveValue(a, catalog)}</Td>
                <Td dataLabel="Since">{formatTimestamp(a.firstBreachAt)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Title headingLevel="h2" style={{ marginTop: '2rem' }}>
        Alert rules
      </Title>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={() => setEdit('new')}>
              Add alert rule
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {state.kind === 'loading' && (
        <Bullseye>
          <Spinner aria-label="Loading alert rules" />
        </Bullseye>
      )}
      {state.kind === 'error' && (
        <Alert variant="danger" title="Could not load alert rules" isInline>
          {state.message}
        </Alert>
      )}
      {state.kind === 'ready' && state.rules.length === 0 && (
        <Alert variant="info" title="No alert rules yet" isInline>
          Click <strong>Add alert rule</strong> to create the first one.
        </Alert>
      )}
      {state.kind === 'ready' && state.rules.length > 0 && (
        <Table aria-label="Alert rules">
          <Thead>
            <Tr>
              <Th width={20}>Name</Th>
              <Th width={20}>Condition</Th>
              <Th width={10}>For</Th>
              <Th width={10}>Severity</Th>
              <Th width={15}>Target</Th>
              <Th width={10}>Enabled</Th>
              <Th screenReaderText="Row actions" />
            </Tr>
          </Thead>
          <Tbody>
            {state.rules.map((rule) => (
              <Tr key={rule.id}>
                <Td dataLabel="Name">{rule.name}</Td>
                <Td dataLabel="Condition">{describeCondition(rule, catalog)}</Td>
                <Td dataLabel="For">{describeFor(rule.forSeconds)}</Td>
                <Td dataLabel="Severity">
                  <Label isCompact color={severityColor(rule.severity)}>
                    {severityLabel(rule.severity)}
                  </Label>
                </Td>
                <Td dataLabel="Target">{describeTarget(rule, groupsById)}</Td>
                <Td dataLabel="Enabled">
                  <Switch
                    id={`alert-${rule.id}-enabled`}
                    aria-label={`Toggle ${rule.name}`}
                    isChecked={rule.enabled}
                    onChange={(_, v) => void handleToggleEnabled(rule, v)}
                  />
                </Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      { title: 'Edit', onClick: () => setEdit(rule) },
                      { isSeparator: true },
                      {
                        title: 'Delete',
                        onClick: () => {
                          if (window.confirm(`Delete alert rule ${rule.name}?`)) {
                            void handleDelete(rule)
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

      <AlertModal
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null)
          refreshRules()
          refreshActive()
        }}
      />
    </PageSection>
  )
}

const COMPARATOR_SYMBOL: Record<Comparator, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
}

function metricLabel(metric: AlertMetric, catalog: AlertCatalogEntry[]): string {
  return catalog.find((c) => c.metric === metric)?.label ?? metric
}

function metricUnit(metric: AlertMetric, catalog: AlertCatalogEntry[]): string {
  return catalog.find((c) => c.metric === metric)?.unit ?? ''
}

function describeCondition(
  rule: AlertRule,
  catalog: AlertCatalogEntry[],
): React.ReactNode {
  switch (rule.conditionKind) {
    case 'unreachable':
      return 'Unreachable'
    case 'metric': {
      const unit = rule.metric ? metricUnit(rule.metric, catalog) : ''
      const sym = rule.comparator ? COMPARATOR_SYMBOL[rule.comparator] : ''
      return `${rule.metric ? metricLabel(rule.metric, catalog) : ''} ${sym} ${rule.threshold}${unit}`
    }
    case 'promql': {
      const sym = rule.comparator ? COMPARATOR_SYMBOL[rule.comparator] : ''
      return (
        <>
          <code>PromQL</code> {sym} {rule.threshold}
        </>
      )
    }
  }
}

function describeActiveValue(
  a: ActiveAlert,
  catalog: AlertCatalogEntry[],
): string {
  if (a.conditionKind === 'unreachable') return '—'
  const unit = a.metric ? metricUnit(a.metric, catalog) : ''
  return `${roundValue(a.value)}${unit}`
}

function roundValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function describeFor(forSeconds: number): string {
  if (forSeconds <= 0) return 'Immediately'
  if (forSeconds % 60 === 0) return `${forSeconds / 60}m`
  return `${forSeconds}s`
}

function describeTarget(
  rule: AlertRule,
  groupsById: Record<string, Group>,
): React.ReactNode {
  switch (rule.targetKind) {
    case 'global':
      return 'Every System'
    case 'group': {
      const g = groupsById[rule.targetValue]
      return <>{g ? g.name : <code>{rule.targetValue}</code>} Group</>
    }
    case 'systems': {
      let count = 0
      try {
        count = (JSON.parse(rule.targetValue) as string[]).length
      } catch {
        // fall back to "0 Systems"
      }
      return `${count} System${count === 1 ? '' : 's'}`
    }
    case 'selector':
      return (
        <>
          Selector <code>{rule.targetValue}</code>
        </>
      )
  }
}

function severityLabel(s: Severity): string {
  switch (s) {
    case 'info':
      return 'Info'
    case 'warning':
      return 'Warning'
    case 'critical':
      return 'Critical'
  }
}

function severityColor(s: Severity): 'blue' | 'orange' | 'red' {
  switch (s) {
    case 'info':
      return 'blue'
    case 'warning':
      return 'orange'
    case 'critical':
      return 'red'
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
