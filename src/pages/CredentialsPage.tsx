// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Label,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  Title,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import CredentialSlotEditor from '../components/CredentialSlotEditor'
import {
  deleteGlobalSlot,
  getGlobalSlot,
  listSlots,
  putGlobalSlot,
  type CredentialSlot,
} from '../api/credentials'

// CredentialsPage is the Administration → "Ansible Credentials"
// page. It edits the global slot inline and shows an admin overview
// of every configured slot (global / group / system) so an
// operator can see at a glance which scopes have credentials
// without drilling into each group or system.
//
// Global Admin only. App.tsx gates the route — this page assumes
// it would not have rendered for a caller without IsGlobalAdmin.
export default function CredentialsPage() {
  return (
    <Stack hasGutter>
      <StackItem>
        <PageSection>
          <Title headingLevel="h1">Ansible Credentials</Title>
        </PageSection>
      </StackItem>
      <StackItem>
        <PageSection>
          <CredentialSlotEditor
            load={getGlobalSlot}
            save={putGlobalSlot}
            remove={deleteGlobalSlot}
            scopeLabel="global default"
          />
        </PageSection>
      </StackItem>
      <StackItem>
        <PageSection>
          <SlotsOverview />
        </PageSection>
      </StackItem>
    </Stack>
  )
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; slots: CredentialSlot[] }
  | { kind: 'error'; message: string }

// SlotsOverview is the at-a-glance table. It reloads on every
// mount and after the global slot is saved (parent passes a key
// so React remounts this). We deliberately do not auto-refresh
// on a tick — credential changes are infrequent and operators
// already see them in the audit log.
function SlotsOverview() {
  const [state, setState] = useState<ListState>({ kind: 'loading' })

  const refresh = useCallback(() => {
    setState({ kind: 'loading' })
    listSlots()
      .then((slots) => setState({ kind: 'ready', slots }))
      .catch((err) =>
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }, [])

  useEffect(() => refresh(), [refresh])

  if (state.kind === 'loading') {
    return (
      <Bullseye>
        <Spinner aria-label="Loading credential slots" />
      </Bullseye>
    )
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="danger" isInline title="Could not load credential slots">
        {state.message}
      </Alert>
    )
  }
  if (state.slots.length === 0) {
    return (
      <Alert variant="info" isInline title="No credential slots configured anywhere">
        Set a global default above to give every system a credential to
        inherit from, then optionally override per-group or per-system on
        their detail pages.
      </Alert>
    )
  }
  return (
    <Table aria-label="All credential slots">
      <Thead>
        <Tr>
          <Th>Scope</Th>
          <Th>Scope ID</Th>
          <Th>Ansible user</Th>
          <Th>Key</Th>
          <Th>Updated</Th>
        </Tr>
      </Thead>
      <Tbody>
        {state.slots.map((s) => (
          <Tr key={`${s.scopeKind}|${s.scopeId ?? ''}`}>
            <Td dataLabel="Scope">
              <Label color={scopeColor(s.scopeKind)}>{s.scopeKind}</Label>
            </Td>
            <Td dataLabel="Scope ID">
              <code>{s.scopeId || '—'}</code>
            </Td>
            <Td dataLabel="Ansible user">{s.ansibleUser || <em>inherits</em>}</Td>
            <Td dataLabel="Key">
              {s.publicKey ? (
                <Label color="green">{originLabel(s.origin)}</Label>
              ) : (
                <em>inherits</em>
              )}
            </Td>
            <Td dataLabel="Updated">{new Date(s.updatedAt).toLocaleString()}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}

function scopeColor(kind: CredentialSlot['scopeKind']): 'blue' | 'purple' | 'orange' {
  switch (kind) {
    case 'global':
      return 'blue'
    case 'group':
      return 'purple'
    case 'system':
      return 'orange'
  }
}

function originLabel(origin: CredentialSlot['origin']): string {
  switch (origin) {
    case 'sw_generated':
      return 'SW-generated'
    case 'user_supplied':
      return 'user-supplied'
    default:
      return 'configured'
  }
}
