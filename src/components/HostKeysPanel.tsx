// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Label,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  acceptHostKey,
  deleteHostKey,
  listHostKeys,
  scanHostKeys,
  type HostKey,
} from '../api/hostkeys'
import { ApiError } from '../api/systems'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; keys: HostKey[] }
  | { kind: 'error'; message: string }

export type Props = {
  systemId: string
  // onReadyChange (optional) fires whenever the panel's trust
  // state transitions across "≥1 accepted key" — used by the
  // parent modal to show/hide the Test connection card.
  onReadyChange?: (ready: boolean) => void
}

// HostKeysPanel is the trust-on-first-use surface for one system.
// Embeds inside SystemCredentialsModal so the operator sees
// pending host keys in the same dialog they configure
// authentication.
//
// Pending rows get Accept + Reject buttons; accepted rows get a
// Delete button (used before re-enrolling a reinstalled host).
// The list refreshes after every action.
export default function HostKeysPanel({ systemId, onReadyChange }: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const refresh = useCallback(() => {
    setState({ kind: 'loading' })
    listHostKeys(systemId)
      .then((keys) => setState({ kind: 'ready', keys }))
      .catch((err) => {
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      })
  }, [systemId])

  useEffect(() => refresh(), [refresh])
  useEffect(() => {
    if (!onReadyChange) return
    const ready =
      state.kind === 'ready' && state.keys.some((k) => k.state === 'accepted')
    onReadyChange(ready)
  }, [state, onReadyChange])

  const accept = async (k: HostKey) => {
    setActionError(null)
    setActionBusy(k.id)
    try {
      await acceptHostKey(systemId, {
        algorithm: k.algorithm,
        fingerprint: k.fingerprint,
      })
      refresh()
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? 'The offered key changed since this banner loaded — refresh to review the new one.'
          : err instanceof Error
            ? err.message
            : String(err)
      setActionError(msg)
      // 409 means the panel was stale; reload to surface what
      // the host is currently offering.
      if (err instanceof ApiError && err.status === 409) refresh()
    } finally {
      setActionBusy(null)
    }
  }

  const scan = async () => {
    setActionError(null)
    setScanning(true)
    try {
      await scanHostKeys(systemId)
      refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const remove = async (k: HostKey) => {
    setActionError(null)
    setActionBusy(k.id)
    try {
      await deleteHostKey(systemId, k.id)
      refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <Card>
      <CardTitle>Host keys</CardTitle>
      <CardBody>
        <Stack hasGutter>
          {state.kind === 'ready' && summaryFor(state.keys) && (
            <StackItem>{summaryFor(state.keys)}</StackItem>
          )}
          <StackItem>
            <Button
              variant="secondary"
              size="sm"
              isLoading={scanning}
              isDisabled={scanning || actionBusy !== null}
              onClick={() => void scan()}
            >
              Capture host keys now
            </Button>
          </StackItem>
          {actionError && (
            <StackItem>
              <Alert variant="danger" isInline title="Action failed">
                {actionError}
              </Alert>
            </StackItem>
          )}
          <StackItem>
            <Body
              state={state}
              busy={actionBusy}
              onAccept={accept}
              onRemove={remove}
            />
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  )
}

// summaryFor surfaces the panel's overall trust state at a glance,
// mirroring the green/yellow left-border cue the EffectivePanel
// above the card already uses. Returns null when there's nothing
// to summarize (the empty-state Alert in Body covers that case).
function summaryFor(keys: HostKey[]): ReactNode {
  if (keys.length === 0) return null
  const accepted = keys.filter((k) => k.state === 'accepted').length
  const pending = keys.filter((k) => k.state === 'pending').length
  if (accepted > 0 && pending === 0) {
    return (
      <Alert
        variant="success"
        isInline
        title={`Host key trust established (${accepted} accepted)`}
      />
    )
  }
  if (accepted > 0) {
    return (
      <Alert
        variant="success"
        isInline
        title={`Host key trust established (${accepted} accepted, ${pending} pending review)`}
      />
    )
  }
  return (
    <Alert
      variant="warning"
      isInline
      title={`Host keys await review (${pending} pending)`}
    />
  )
}

function Body({
  state,
  busy,
  onAccept,
  onRemove,
}: {
  state: LoadState
  busy: string | null
  onAccept: (k: HostKey) => void
  onRemove: (k: HostKey) => void
}) {
  if (state.kind === 'loading') {
    return (
      <Bullseye>
        <Spinner aria-label="Loading host keys" />
      </Bullseye>
    )
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="danger" isInline title="Could not load host keys">
        {state.message}
      </Alert>
    )
  }
  if (state.keys.length === 0) {
    return (
      <Alert variant="info" isInline title="No host keys recorded yet">
        Trigger an ansible run against this system to capture what
        it offers. Until a key is accepted, runs will refuse to
        connect.
      </Alert>
    )
  }
  return (
    <Table aria-label="Host keys" variant="compact">
      <Thead>
        <Tr>
          <Th>State</Th>
          <Th>Algorithm</Th>
          <Th>Fingerprint</Th>
          <Th>First seen</Th>
          <Th>Accepted</Th>
          <Th aria-label="actions" />
        </Tr>
      </Thead>
      <Tbody>
        {state.keys.map((k) => (
          <Tr key={k.id}>
            <Td dataLabel="State">
              <Label color={k.state === 'accepted' ? 'green' : 'orange'} isCompact>
                {k.state}
              </Label>
            </Td>
            <Td dataLabel="Algorithm">
              <code>{k.algorithm}</code>
            </Td>
            <Td dataLabel="Fingerprint" modifier="truncate">
              <code>{k.fingerprint}</code>
            </Td>
            <Td dataLabel="First seen">
              {new Date(k.firstSeenAt).toLocaleString()}
            </Td>
            <Td dataLabel="Accepted">
              {k.acceptedAt ? new Date(k.acceptedAt).toLocaleString() : '—'}
            </Td>
            <Td dataLabel="Actions" isActionCell>
              {k.state === 'pending' ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    isLoading={busy === k.id}
                    isDisabled={busy !== null}
                    onClick={() => onAccept(k)}
                  >
                    Accept
                  </Button>{' '}
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={busy === k.id}
                    isDisabled={busy !== null}
                    onClick={() => onRemove(k)}
                  >
                    Reject
                  </Button>
                </>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={busy === k.id}
                  isDisabled={busy !== null}
                  onClick={() => onRemove(k)}
                >
                  Delete
                </Button>
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}
