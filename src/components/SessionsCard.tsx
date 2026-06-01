// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Label,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  listSessions,
  revokeOtherSessions,
  revokeSession,
  type Session,
} from '../api/auth'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : dateFormatter.format(d)
}

export default function SessionsCard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await listSessions())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onRevoke = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await revokeSession(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onRevokeOthers = async () => {
    setBusy(true)
    setError(null)
    try {
      await revokeOtherSessions()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // "Sign out everywhere else" only makes sense when there's at least one
  // other session to revoke.
  const hasOthers = sessions.some((s) => !s.current)

  return (
    <Card>
      <CardTitle>Active sessions</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            Each browser you sign in from gets its own session. Revoke any
            you don&apos;t recognise — that browser is signed out on its next
            request.
          </StackItem>
          {error && (
            <StackItem>
              <Alert variant="danger" title="Active sessions" isInline>
                {error}
              </Alert>
            </StackItem>
          )}
          <StackItem>
            {loading ? (
              <p>Loading…</p>
            ) : sessions.length === 0 ? (
              <p>No active sessions.</p>
            ) : (
              <Table aria-label="Active sessions">
                <Thead>
                  <Tr>
                    <Th>Browser</Th>
                    <Th>IP</Th>
                    <Th>Last seen</Th>
                    <Th>Expires</Th>
                    <Th screenReaderText="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {sessions.map((s) => (
                    <Tr key={s.id}>
                      <Td dataLabel="Browser">
                        {s.label || 'Unknown browser'}
                        {s.current && (
                          <Label isCompact color="blue" style={{ marginInlineStart: '0.5rem' }}>
                            This browser
                          </Label>
                        )}
                      </Td>
                      <Td dataLabel="IP">{s.ip || '—'}</Td>
                      <Td dataLabel="Last seen">{formatTimestamp(s.lastSeenAt)}</Td>
                      <Td dataLabel="Expires">{formatTimestamp(s.expiresAt)}</Td>
                      <Td>
                        {s.current ? (
                          <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                            Use Sign out
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            isDanger
                            isDisabled={busy}
                            onClick={() => void onRevoke(s.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </StackItem>
          {hasOthers && (
            <StackItem>
              <Button
                variant="secondary"
                isDanger
                isDisabled={busy}
                onClick={() => void onRevokeOthers()}
              >
                Sign out everywhere else
              </Button>
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}
