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
  type ChannelType,
  deleteChannel,
  listChannels,
  listDeliveries,
  type NotificationChannel,
  type NotificationDelivery,
  testChannel,
  updateChannel,
} from '../api/notifications'
import { ApiError } from '../api/systems'
import ChannelModal from '../components/ChannelModal'
import DeliveryPolicyCard from '../components/DeliveryPolicyCard'
import RoutingMatrix from '../components/RoutingMatrix'

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; channels: NotificationChannel[] }

type TestOutcome = { name: string; ok: boolean; error?: string }

// NotificationChannelsPage is the Administration → Notifications view.
// It lists the delivery channels firing/resolved alerts are sent to,
// with Add / Edit / Delete / Test / enable-toggle, plus a recent-
// deliveries log. Global Admin only; RBAC is enforced server-side and
// 403s surface as inline errors.
export default function NotificationChannelsPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null)
  const [edit, setEdit] = useState<NotificationChannel | 'new' | null>(null)

  const refresh = useCallback(() => {
    listChannels()
      .then((channels) => setState({ kind: 'ready', channels }))
      .catch((err) =>
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
  }, [])

  const refreshDeliveries = useCallback(() => {
    listDeliveries(20)
      .then(setDeliveries)
      .catch(() => {
        // Non-fatal — the channel table is the primary content.
      })
  }, [])

  useEffect(() => {
    refresh()
    refreshDeliveries()
  }, [refresh, refreshDeliveries])

  const handleDelete = async (c: NotificationChannel) => {
    setActionError(null)
    try {
      await deleteChannel(c.id)
      refresh()
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  const handleToggle = async (c: NotificationChannel, enabled: boolean) => {
    setActionError(null)
    try {
      // Full payload required on PUT; ship the existing config with only
      // the enabled flag flipped. Secret omitted → preserved server-side.
      await updateChannel(c.id, {
        name: c.name,
        type: c.type,
        enabled,
        config: c.config,
      })
      refresh()
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  const handleTest = async (c: NotificationChannel) => {
    setActionError(null)
    setTestOutcome(null)
    try {
      const result = await testChannel(c.id)
      setTestOutcome({ name: c.name, ok: result.ok, error: result.error })
      refreshDeliveries()
    } catch (err) {
      setActionError(asMessage(err))
    }
  }

  return (
    <PageSection>
      <Title headingLevel="h1">Notifications</Title>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={() => setEdit('new')}>
              Add channel
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
      {testOutcome && (
        <Alert
          variant={testOutcome.ok ? 'success' : 'danger'}
          title={
            testOutcome.ok
              ? `Test sent through ${testOutcome.name}`
              : `Test through ${testOutcome.name} failed`
          }
          isInline
          actionClose={
            <Button variant="plain" onClick={() => setTestOutcome(null)} aria-label="Dismiss test result">
              ×
            </Button>
          }
        >
          {testOutcome.ok ? 'Delivery succeeded.' : testOutcome.error}
        </Alert>
      )}

      {state.kind === 'loading' && (
        <Bullseye>
          <Spinner aria-label="Loading channels" />
        </Bullseye>
      )}
      {state.kind === 'error' && (
        <Alert variant="danger" title="Could not load channels" isInline>
          {state.message}
        </Alert>
      )}
      {state.kind === 'ready' && state.channels.length === 0 && (
        <Alert variant="info" title="No channels yet" isInline>
          Click <strong>Add channel</strong> to deliver alerts by email, Slack, webhook, or SMS.
        </Alert>
      )}
      {state.kind === 'ready' && state.channels.length > 0 && (
        <Table aria-label="Notification channels">
          <Thead>
            <Tr>
              <Th width={30}>Name</Th>
              <Th width={15}>Type</Th>
              <Th width={20}>Enabled</Th>
              <Th screenReaderText="Row actions" />
            </Tr>
          </Thead>
          <Tbody>
            {state.channels.map((c) => (
              <Tr key={c.id}>
                <Td dataLabel="Name">{c.name}</Td>
                <Td dataLabel="Type">
                  <Label isCompact>{typeLabel(c.type)}</Label>
                </Td>
                <Td dataLabel="Enabled">
                  <Switch
                    id={`channel-${c.id}-enabled`}
                    aria-label={`Toggle ${c.name}`}
                    isChecked={c.enabled}
                    onChange={(_, v) => void handleToggle(c, v)}
                  />
                </Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      { title: 'Edit', onClick: () => setEdit(c) },
                      { title: 'Send test', onClick: () => void handleTest(c) },
                      { isSeparator: true },
                      {
                        title: 'Delete',
                        onClick: () => {
                          if (window.confirm(`Delete channel ${c.name}?`)) {
                            void handleDelete(c)
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

      <Title headingLevel="h2" style={{ marginTop: '2rem' }}>
        Delivery policy
      </Title>
      <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
        <DeliveryPolicyCard />
      </div>

      <Title headingLevel="h2" style={{ marginTop: '2rem' }}>
        Routing
      </Title>
      <p style={{ marginBottom: '1rem' }}>
        Choose which channels each rule delivers to. Rules default to all enabled channels; the
        dashboard shows every active alert regardless of routing.
      </p>
      <RoutingMatrix />

      <Title headingLevel="h2" style={{ marginTop: '2rem' }}>
        Recent deliveries
      </Title>
      {deliveries.length === 0 ? (
        <Alert variant="info" title="No deliveries yet" isInline>
          Deliveries appear here once an alert fires or you send a test.
        </Alert>
      ) : (
        <Table aria-label="Recent deliveries" variant="compact">
          <Thead>
            <Tr>
              <Th width={20}>Channel</Th>
              <Th width={10}>Kind</Th>
              <Th width={20}>Rule</Th>
              <Th width={15}>System</Th>
              <Th width={10}>Status</Th>
              <Th width={25}>When</Th>
            </Tr>
          </Thead>
          <Tbody>
            {deliveries.map((d) => (
              <Tr key={d.id}>
                <Td dataLabel="Channel">{d.channelName}</Td>
                <Td dataLabel="Kind">{d.kind}</Td>
                <Td dataLabel="Rule">{d.ruleName}</Td>
                <Td dataLabel="System">{d.systemId || '—'}</Td>
                <Td dataLabel="Status">
                  <Label isCompact color={d.status === 'success' ? 'green' : 'red'}>
                    {d.status === 'success' ? 'Success' : 'Failed'}
                  </Label>
                </Td>
                <Td dataLabel="When">{formatTimestamp(d.at)}{d.error ? ` — ${d.error}` : ''}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <ChannelModal
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null)
          refresh()
        }}
      />
    </PageSection>
  )
}

function typeLabel(t: ChannelType): string {
  switch (t) {
    case 'email':
      return 'Email'
    case 'slack':
      return 'Slack'
    case 'webhook':
      return 'Webhook'
    case 'sms':
      return 'SMS'
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
