// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Spinner,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { fetchMyScope, type Role, type Scope } from '../api/roles'
import { listGroups, type Group } from '../api/groups'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  operator: 'Operator',
  auditor: 'Auditor',
}

// MyRolesCard is the read-only "my access" card on the profile page.
// It reads /api/me/scope (open to every authenticated user) so it
// works for users who cannot see /api/admin/role-assignments. Group
// names are resolved by listing /api/groups — group-only callers see
// only the groups they can read, which is exactly the set that
// appears here, so every name resolves.
export default function MyRolesCard() {
  const [scope, setScope] = useState<Scope | null>(null)
  const [groupNames, setGroupNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [s, gs] = await Promise.all([
          fetchMyScope(),
          listGroups().catch(() => [] as Group[]),
        ])
        if (cancelled) return
        setScope(s)
        const names: Record<string, string> = {}
        for (const g of gs) names[g.id] = g.name
        setGroupNames(names)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card>
      <CardTitle>My access</CardTitle>
      <CardBody>
        {error && (
          <Alert variant="danger" title="Could not load roles" isInline>
            {error}
          </Alert>
        )}
        {!error && scope === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {scope !== null && scope.global === '' && Object.keys(scope.groups).length === 0 && (
          <EmptyState titleText="No access" headingLevel="h3">
            <EmptyStateBody>
              No role assignments yet. Ask an administrator if you need access.
            </EmptyStateBody>
          </EmptyState>
        )}
        {scope !== null && (scope.global !== '' || Object.keys(scope.groups).length > 0) && (
          <Table aria-label="My role assignments" variant="compact">
            <Thead>
              <Tr>
                <Th>Scope</Th>
                <Th>Role</Th>
              </Tr>
            </Thead>
            <Tbody>
              {scope.global !== '' && (
                <Tr>
                  <Td dataLabel="Scope">Global (install-wide)</Td>
                  <Td dataLabel="Role">{ROLE_LABEL[scope.global]}</Td>
                </Tr>
              )}
              {Object.entries(scope.groups).map(([gid, role]) => (
                <Tr key={gid}>
                  <Td dataLabel="Scope">Group: {groupNames[gid] ?? gid}</Td>
                  <Td dataLabel="Role">{ROLE_LABEL[role]}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  )
}
