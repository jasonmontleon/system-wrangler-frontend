// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { Alert, Bullseye, Button, Checkbox, Spinner, Switch } from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { type AlertRule, listAlertRules } from '../api/alerts'
import {
  getRouting,
  listChannels,
  type NotificationChannel,
  type RuleRouting,
  setRouting,
} from '../api/notifications'
import { ApiError } from '../api/systems'

type Ready = {
  kind: 'ready'
  rules: AlertRule[]
  channels: NotificationChannel[]
  // routing keyed by ruleId; a rule absent from the map uses the default
  // (mode 'all' — deliver to every enabled channel).
  routing: Record<string, RuleRouting>
}
type State = { kind: 'loading' } | { kind: 'error'; message: string } | Ready

// effectiveRouting resolves a rule's stored routing, defaulting an absent
// row to all-enabled-channels.
function effectiveRouting(routing: Record<string, RuleRouting>, ruleId: string): RuleRouting {
  return routing[ruleId] ?? { ruleId, mode: 'all', channelIds: null }
}

// RoutingMatrix is the rules × channels grid on the Notifications page.
// Each rule routes either to every enabled channel (the default) or to a
// selected subset. The dashboard always reflects active alerts regardless
// of routing, so routing governs only the configured channels. Global
// Admin only; RBAC is enforced server-side and 403s surface inline.
export default function RoutingMatrix() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    Promise.all([listAlertRules(), listChannels(), getRouting()])
      .then(([rules, channels, rows]) => {
        const routing: Record<string, RuleRouting> = {}
        for (const r of rows) routing[r.ruleId] = r
        setState({ kind: 'ready', rules, channels, routing })
      })
      .catch((err) =>
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
  }, [])

  useEffect(() => refresh(), [refresh])

  const save = async (ruleId: string, input: { mode: 'all' | 'selected'; channelIds?: string[] }) => {
    setActionError(null)
    try {
      const saved = await setRouting(ruleId, input)
      setState((prev) =>
        prev.kind === 'ready'
          ? { ...prev, routing: { ...prev.routing, [ruleId]: saved } }
          : prev,
      )
    } catch (err) {
      setActionError(err instanceof ApiError || err instanceof Error ? err.message : String(err))
    }
  }

  const toggleAll = (rule: AlertRule, allChannels: boolean) => {
    if (allChannels) {
      void save(rule.id, { mode: 'all' })
    } else {
      // Drop to an explicit (initially empty) selection.
      void save(rule.id, { mode: 'selected', channelIds: [] })
    }
  }

  const toggleChannel = (
    rule: AlertRule,
    current: RuleRouting,
    channelId: string,
    checked: boolean,
  ) => {
    const selected = new Set(current.channelIds ?? [])
    if (checked) selected.add(channelId)
    else selected.delete(channelId)
    void save(rule.id, { mode: 'selected', channelIds: [...selected] })
  }

  if (state.kind === 'loading') {
    return (
      <Bullseye>
        <Spinner aria-label="Loading routing" />
      </Bullseye>
    )
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="danger" title="Could not load routing" isInline>
        {state.message}
      </Alert>
    )
  }
  if (state.rules.length === 0) {
    return (
      <Alert variant="info" title="No alert rules yet" isInline>
        Create an alert rule on the Alerts page, then choose where it delivers here.
      </Alert>
    )
  }
  if (state.channels.length === 0) {
    return (
      <Alert variant="info" title="No channels to route to" isInline>
        Add a channel above. Until then, every rule delivers to all enabled channels by default.
      </Alert>
    )
  }

  return (
    <>
      {actionError && (
        <Alert
          variant="danger"
          title="Could not save routing"
          isInline
          actionClose={
            <Button variant="plain" onClick={() => setActionError(null)} aria-label="Dismiss routing error">
              ×
            </Button>
          }
        >
          {actionError}
        </Alert>
      )}
      <Table aria-label="Alert routing">
        <Thead>
          <Tr>
            <Th width={25}>Rule</Th>
            <Th width={20}>All Enabled Channels</Th>
            {state.channels.map((c) => (
              <Th key={c.id}>{c.enabled ? c.name : `${c.name} (Disabled)`}</Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {state.rules.map((rule) => {
            const routing = effectiveRouting(state.routing, rule.id)
            const all = routing.mode === 'all'
            const selected = new Set(routing.channelIds ?? [])
            return (
              <Tr key={rule.id}>
                <Td dataLabel="Rule">{rule.name}</Td>
                <Td dataLabel="All Enabled Channels">
                  <Switch
                    id={`routing-${rule.id}-all`}
                    aria-label={`Route ${rule.name} to all enabled channels`}
                    isChecked={all}
                    onChange={(_, v) => toggleAll(rule, v)}
                  />
                </Td>
                {state.channels.map((c) => (
                  <Td key={c.id} dataLabel={c.name}>
                    <Checkbox
                      id={`routing-${rule.id}-${c.id}`}
                      aria-label={`Route ${rule.name} to ${c.name}`}
                      isDisabled={all}
                      isChecked={!all && selected.has(c.id)}
                      onChange={(_, checked) => toggleChannel(rule, routing, c.id, checked)}
                    />
                  </Td>
                ))}
              </Tr>
            )
          })}
        </Tbody>
      </Table>
    </>
  )
}
