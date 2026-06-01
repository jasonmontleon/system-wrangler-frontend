// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Stack, StackItem } from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  listUserSessions,
  revokeUserSession,
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

type Props = {
  userId: string
  username: string
}

// UserSessionsCard is the admin view of one user's active sessions, with
// a per-row revoke. Rendered inside the Users-page modal, mirroring
// UserRolesCard. It does not flag a "current" row — the admin viewing
// the list isn't the session owner.
export default function UserSessionsCard({ userId, username }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSessions(await listUserSessions(userId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onRevoke = async (sessionId: string) => {
    setBusy(true)
    setError(null)
    try {
      await revokeUserSession(userId, sessionId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack hasGutter>
      <StackItem>
        Active sessions for <strong>{username}</strong>. Revoke one to sign
        that browser out on its next request. To sign them out everywhere at
        once, disable the account or reset their password.
      </StackItem>
      {error && (
        <StackItem>
          <Alert variant="danger" title="Sessions" isInline>
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
          <Table aria-label={`Sessions for ${username}`} variant="compact">
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
                  <Td dataLabel="Browser">{s.label || 'Unknown browser'}</Td>
                  <Td dataLabel="IP">{s.ip || '—'}</Td>
                  <Td dataLabel="Last seen">{formatTimestamp(s.lastSeenAt)}</Td>
                  <Td dataLabel="Expires">{formatTimestamp(s.expiresAt)}</Td>
                  <Td>
                    <Button
                      variant="secondary"
                      isDanger
                      isDisabled={busy}
                      onClick={() => void onRevoke(s.id)}
                    >
                      Revoke
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </StackItem>
    </Stack>
  )
}
