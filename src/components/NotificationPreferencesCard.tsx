// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Label,
  Spinner,
  Split,
  SplitItem,
  Stack,
  StackItem,
  Switch,
  Title,
} from '@patternfly/react-core'
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  type AlertSubscription,
  type ChannelType,
  createMyChannel,
  deleteMyChannel,
  getMySubscription,
  listMyChannels,
  listMyDeliveries,
  type NotificationChannel,
  type NotificationDelivery,
  setMySubscription,
  testMyChannel,
  updateMyChannel,
} from '../api/notifications'
import { type Group, listGroups } from '../api/groups'
import { ApiError } from '../api/systems'
import ChannelModal from './ChannelModal'

const SEVERITIES = ['info', 'warning', 'critical'] as const
const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}

function asMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message
  return String(err)
}

// NotificationPreferencesCard is the self-service per-user delivery surface
// on the Profile page: a user's own channels, what alerts they subscribe
// to, and their recent personal deliveries. The matching quiet-hours /
// severity editor is the reused DeliveryPolicyCard mounted alongside.
export default function NotificationPreferencesCard() {
  return (
    <Card>
      <CardTitle>Notifications</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <PersonalChannels />
          </StackItem>
          <StackItem>
            <SubscriptionEditor />
          </StackItem>
          <StackItem>
            <RecentDeliveries />
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  )
}

function typeLabel(t: ChannelType): string {
  return { email: 'Email', slack: 'Slack', webhook: 'Webhook', sms: 'SMS' }[t]
}

function PersonalChannels() {
  const [channels, setChannels] = useState<NotificationChannel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<NotificationChannel | 'new' | null>(null)
  const [testOutcome, setTestOutcome] = useState<{ name: string; ok: boolean; error?: string } | null>(null)

  const refresh = useCallback(() => {
    listMyChannels()
      .then(setChannels)
      .catch((err) => setError(asMessage(err)))
  }, [])
  useEffect(() => refresh(), [refresh])

  const handleToggle = async (c: NotificationChannel, enabled: boolean) => {
    setError(null)
    try {
      await updateMyChannel(c.id, { name: c.name, type: c.type, enabled, config: c.config })
      refresh()
    } catch (err) {
      setError(asMessage(err))
    }
  }

  const handleTest = async (c: NotificationChannel) => {
    setError(null)
    setTestOutcome(null)
    try {
      const res = await testMyChannel(c.id)
      setTestOutcome({ name: c.name, ok: res.ok, error: res.error })
    } catch (err) {
      setError(asMessage(err))
    }
  }

  const handleDelete = async (c: NotificationChannel) => {
    setError(null)
    try {
      await deleteMyChannel(c.id)
      refresh()
    } catch (err) {
      setError(asMessage(err))
    }
  }

  return (
    <>
      <Split hasGutter>
        <SplitItem isFilled>
          <Title headingLevel="h3">My Channels</Title>
        </SplitItem>
        <SplitItem>
          <Button variant="secondary" onClick={() => setEdit('new')}>
            Add channel
          </Button>
        </SplitItem>
      </Split>

      {error && (
        <Alert variant="danger" title="Action failed" isInline>
          {error}
        </Alert>
      )}
      {testOutcome && (
        <Alert
          variant={testOutcome.ok ? 'success' : 'danger'}
          title={testOutcome.ok ? `Test sent through ${testOutcome.name}` : `Test through ${testOutcome.name} failed`}
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

      {channels === null ? (
        <Bullseye>
          <Spinner aria-label="Loading channels" />
        </Bullseye>
      ) : channels.length === 0 ? (
        <Alert variant="info" title="No personal channels yet" isInline>
          Add a channel to be notified by email, Slack, webhook, or SMS about the alerts you subscribe to.
        </Alert>
      ) : (
        <Table aria-label="My notification channels" variant="compact">
          <Thead>
            <Tr>
              <Th width={40}>Name</Th>
              <Th width={20}>Type</Th>
              <Th width={20}>Enabled</Th>
              <Th screenReaderText="Row actions" />
            </Tr>
          </Thead>
          <Tbody>
            {channels.map((c) => (
              <Tr key={c.id}>
                <Td dataLabel="Name">{c.name}</Td>
                <Td dataLabel="Type">
                  <Label isCompact>{typeLabel(c.type)}</Label>
                </Td>
                <Td dataLabel="Enabled">
                  <Switch
                    id={`my-channel-${c.id}-enabled`}
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
                          if (window.confirm(`Delete channel ${c.name}?`)) void handleDelete(c)
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

      <ChannelModal
        target={edit}
        create={createMyChannel}
        update={updateMyChannel}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null)
          refresh()
        }}
      />
    </>
  )
}

function SubscriptionEditor() {
  const [sub, setSub] = useState<AlertSubscription | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([getMySubscription(), listGroups()])
      .then(([s, g]) => {
        setSub(s)
        setGroups(g)
      })
      .catch((err) => setError(asMessage(err)))
  }, [])

  const patch = (p: Partial<AlertSubscription>) => {
    setSub((prev) => (prev ? { ...prev, ...p } : prev))
    setSaved(false)
  }

  const toggleIn = (list: string[], value: string, on: boolean) =>
    on ? [...list, value] : list.filter((v) => v !== value)

  const save = async () => {
    if (!sub) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      setSub(await setMySubscription(sub))
      setSaved(true)
    } catch (err) {
      setError(asMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (error && !sub) {
    return (
      <Alert variant="danger" title="Could not load subscription" isInline>
        {error}
      </Alert>
    )
  }
  if (!sub) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading subscription" />
      </Bullseye>
    )
  }

  return (
    <Stack hasGutter>
      <StackItem>
        <Title headingLevel="h3">What I'm Notified About</Title>
      </StackItem>
      <StackItem>
        <Switch
          id="subscription-enabled"
          label="Send me alerts on my channels"
          isChecked={sub.enabled}
          onChange={(_, v) => patch({ enabled: v })}
          isDisabled={saving}
        />
      </StackItem>

      {sub.enabled && (
        <>
          <StackItem>
            <Title headingLevel="h4">Severities</Title>
            <p>Leave all unchecked to receive every severity.</p>
            <Split hasGutter>
              {SEVERITIES.map((sev) => (
                <SplitItem key={sev}>
                  <Checkbox
                    id={`sub-sev-${sev}`}
                    label={SEVERITY_LABELS[sev]}
                    isChecked={sub.severities.includes(sev)}
                    isDisabled={saving}
                    onChange={(_, on) => patch({ severities: toggleIn(sub.severities, sev, on) })}
                  />
                </SplitItem>
              ))}
            </Split>
          </StackItem>

          <StackItem>
            <Title headingLevel="h4">Groups</Title>
            <p>Leave all unchecked to receive alerts from every group you can see.</p>
            {groups.length === 0 ? (
              <Alert variant="info" title="No groups" isInline>
                There are no system groups to choose from yet.
              </Alert>
            ) : (
              <Split hasGutter>
                {groups.map((g) => (
                  <SplitItem key={g.id}>
                    <Checkbox
                      id={`sub-group-${g.id}`}
                      label={g.name}
                      isChecked={sub.groups.includes(g.id)}
                      isDisabled={saving}
                      onChange={(_, on) => patch({ groups: toggleIn(sub.groups, g.id, on) })}
                    />
                  </SplitItem>
                ))}
              </Split>
            )}
          </StackItem>
        </>
      )}

      {error && (
        <StackItem>
          <Alert variant="danger" title="Could not save subscription" isInline>
            {error}
          </Alert>
        </StackItem>
      )}
      {saved && (
        <StackItem>
          <Alert variant="success" title="Subscription saved" isInline />
        </StackItem>
      )}
      <StackItem>
        <Button variant="primary" onClick={() => void save()} isLoading={saving} isDisabled={saving}>
          Save subscription
        </Button>
      </StackItem>
    </Stack>
  )
}

function RecentDeliveries() {
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([])

  useEffect(() => {
    listMyDeliveries(20)
      .then(setDeliveries)
      .catch(() => {
        // Non-fatal — the channels + subscription are the primary content.
      })
  }, [])

  return (
    <>
      <Title headingLevel="h3">My Recent Deliveries</Title>
      {deliveries.length === 0 ? (
        <Alert variant="info" title="No deliveries yet" isInline>
          Deliveries appear here once a subscribed alert fires or you send a test.
        </Alert>
      ) : (
        <Table aria-label="My recent deliveries" variant="compact">
          <Thead>
            <Tr>
              <Th width={25}>Channel</Th>
              <Th width={15}>Kind</Th>
              <Th width={25}>Rule</Th>
              <Th width={15}>Status</Th>
              <Th width={20}>When</Th>
            </Tr>
          </Thead>
          <Tbody>
            {deliveries.map((d) => (
              <Tr key={d.id}>
                <Td dataLabel="Channel">{d.channelName || '—'}</Td>
                <Td dataLabel="Kind">{d.kind}</Td>
                <Td dataLabel="Rule">{d.ruleName}</Td>
                <Td dataLabel="Status">
                  <Label isCompact color={d.status === 'success' ? 'green' : d.status === 'failed' ? 'red' : 'grey'}>
                    {d.status}
                  </Label>
                </Td>
                <Td dataLabel="When">
                  {new Date(d.at).toLocaleString()}
                  {d.error ? ` — ${d.error}` : ''}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </>
  )
}
