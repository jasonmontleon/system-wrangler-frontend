// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  MenuToggle,
  type MenuToggleElement,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  SelectList,
  SelectOption,
  Spinner,
} from '@patternfly/react-core'
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  grantAdminRole,
  listAdminRoleAssignments,
  revokeAdminRole,
  type Role,
  type RoleAssignment,
} from '../api/roles'
import { listGroups, type Group } from '../api/groups'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  operator: 'Operator',
  auditor: 'Auditor',
}

type Props = {
  // userId is the user whose assignments to display.
  userId: string
  username: string
  // editable: when true, the caller may grant and revoke. Always set
  // by the Global Admin path; the user's own profile view sets it
  // false so they see their own roles read-only.
  editable: boolean
}

// UserRolesCard lists every assignment held by userId, grouped
// visually into Global and per-group sections. Editing always goes
// through /api/admin/role-assignments which is Global-Admin-only on
// the backend; the editable flag is a UI gate only.
export default function UserRolesCard({ userId, username, editable }: Props) {
  const [assignments, setAssignments] = useState<RoleAssignment[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const all = await listAdminRoleAssignments()
      setAssignments(all.filter((a) => a.userId === userId))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Groups only needed when editable (for the picker).
  useEffect(() => {
    if (!editable) return
    let cancelled = false
    void (async () => {
      try {
        const list = await listGroups()
        if (!cancelled) setGroups(list)
      } catch {
        if (!cancelled) setGroups([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editable])

  const revoke = async (a: RoleAssignment) => {
    setActionError(null)
    try {
      await revokeAdminRole(a.userId, a.groupId, a.role)
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const globals = useMemo(
    () => (assignments ?? []).filter((a) => a.groupId === null),
    [assignments],
  )
  const perGroup = useMemo(
    () => (assignments ?? []).filter((a) => a.groupId !== null),
    [assignments],
  )

  return (
    <Card>
      <CardTitle>Roles</CardTitle>
      <CardBody>
        {loadError && (
          <Alert variant="danger" title="Could not load roles" isInline>
            {loadError}
          </Alert>
        )}
        {actionError && (
          <Alert variant="danger" title="Action failed" isInline>
            {actionError}
          </Alert>
        )}
        {!loadError && assignments === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {assignments !== null && globals.length === 0 && perGroup.length === 0 && (
          <EmptyState titleText="No roles assigned" headingLevel="h3">
            <EmptyStateBody>
              {editable
                ? 'This user cannot see or do anything yet. Use Grant role to give them access.'
                : 'You have no role assignments. Ask an administrator if you need access.'}
            </EmptyStateBody>
          </EmptyState>
        )}
        {assignments !== null && (globals.length > 0 || perGroup.length > 0) && (
          <RoleTable
            globals={globals}
            perGroup={perGroup}
            editable={editable}
            onRevoke={revoke}
          />
        )}
        {editable && (
          <div style={{ marginTop: '0.75rem' }}>
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              Grant role
            </Button>
          </div>
        )}
      </CardBody>
      <AddAssignmentModal
        isOpen={isAddOpen}
        username={username}
        groups={groups}
        existing={assignments ?? []}
        onClose={() => setAddOpen(false)}
        onSubmit={async (groupId, role) => {
          setActionError(null)
          try {
            await grantAdminRole(userId, groupId, role)
            setAddOpen(false)
            await refresh()
          } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err))
          }
        }}
      />
    </Card>
  )
}

type RoleTableProps = {
  globals: RoleAssignment[]
  perGroup: RoleAssignment[]
  editable: boolean
  onRevoke: (a: RoleAssignment) => void | Promise<void>
}

function RoleTable({ globals, perGroup, editable, onRevoke }: RoleTableProps) {
  return (
    <Table aria-label="Role assignments" variant="compact">
      <Thead>
        <Tr>
          <Th>Scope</Th>
          <Th>Role</Th>
          {editable && <Th screenReaderText="Actions" />}
        </Tr>
      </Thead>
      <Tbody>
        {globals.map((a) => (
          <Tr key={`global:${a.role}`}>
            <Td dataLabel="Scope">Global (install-wide)</Td>
            <Td dataLabel="Role">{ROLE_LABEL[a.role]}</Td>
            {editable && (
              <Td dataLabel="Actions" isActionCell>
                <ActionsColumn
                  items={[
                    {
                      title: `Revoke Global ${ROLE_LABEL[a.role]}`,
                      onClick: () => void onRevoke(a),
                    },
                  ]}
                />
              </Td>
            )}
          </Tr>
        ))}
        {perGroup.map((a) => (
          <Tr key={`${a.groupId}:${a.role}`}>
            <Td dataLabel="Scope">
              Group: {a.groupName || a.groupId || '?'}
            </Td>
            <Td dataLabel="Role">{ROLE_LABEL[a.role]}</Td>
            {editable && (
              <Td dataLabel="Actions" isActionCell>
                <ActionsColumn
                  items={[
                    {
                      title: `Revoke ${ROLE_LABEL[a.role]} on ${a.groupName || a.groupId}`,
                      onClick: () => void onRevoke(a),
                    },
                  ]}
                />
              </Td>
            )}
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}

type AddAssignmentModalProps = {
  isOpen: boolean
  username: string
  groups: Group[] | null
  existing: RoleAssignment[]
  onClose: () => void
  onSubmit: (groupId: string | null, role: Role) => void | Promise<void>
}

function AddAssignmentModal({
  isOpen,
  username,
  groups,
  existing,
  onClose,
  onSubmit,
}: AddAssignmentModalProps) {
  // scope is either "global" (NULL group_id) or a specific group id.
  const [scope, setScope] = useState<string>('global')
  const [role, setRole] = useState<Role>('operator')
  const [submitting, setSubmitting] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setScope('global')
      setRole('operator')
      setSubmitting(false)
    }
  }, [isOpen])

  // Filter out the (scope, role) combos that already exist so the
  // backend's 409 never lands as a confusing error.
  const isTaken = useMemo(
    () =>
      (s: string, r: Role) =>
        existing.some((a) => {
          const aScope = a.groupId === null ? 'global' : a.groupId
          return aScope === s && a.role === r
        }),
    [existing],
  )

  const scopeChoices = useMemo(() => {
    const out: { value: string; label: string }[] = [
      { value: 'global', label: 'Global (install-wide)' },
    ]
    for (const g of groups ?? []) {
      out.push({ value: g.id, label: `Group: ${g.name}` })
    }
    return out
  }, [groups])

  const selectedScopeLabel =
    scopeChoices.find((c) => c.value === scope)?.label ?? 'Select a scope'

  const disabledSubmit = submitting || isTaken(scope, role)

  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="grant-role-title"
    >
      <ModalHeader title={`Grant role to ${username}`} labelId="grant-role-title" />
      <ModalBody>
        <Form id="grant-role-form">
          <FormGroup label="Scope" fieldId="grant-role-scope" isRequired>
            <Select
              id="grant-role-scope"
              isOpen={scopeOpen}
              selected={scope}
              onSelect={(_, value) => {
                setScope(String(value ?? 'global'))
                setScopeOpen(false)
              }}
              onOpenChange={(open) => setScopeOpen(open)}
              toggle={(ref: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={ref}
                  isExpanded={scopeOpen}
                  onClick={() => setScopeOpen((o) => !o)}
                  aria-label="Scope picker"
                >
                  {selectedScopeLabel}
                </MenuToggle>
              )}
            >
              <SelectList>
                {scopeChoices.map((c) => (
                  <SelectOption key={c.value} value={c.value}>
                    {c.label}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </FormGroup>
          <FormGroup label="Role" fieldId="grant-role-role" isRequired>
            <Select
              id="grant-role-role"
              isOpen={roleOpen}
              selected={role}
              onSelect={(_, value) => {
                setRole(value as Role)
                setRoleOpen(false)
              }}
              onOpenChange={(open) => setRoleOpen(open)}
              toggle={(ref: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={ref}
                  isExpanded={roleOpen}
                  onClick={() => setRoleOpen((o) => !o)}
                  aria-label="Role picker"
                >
                  {ROLE_LABEL[role]}
                </MenuToggle>
              )}
            >
              <SelectList>
                {(['admin', 'operator', 'auditor'] as Role[]).map((r) => (
                  <SelectOption key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </FormGroup>
          {isTaken(scope, role) && (
            <Alert
              variant="info"
              title="This user already has that role on the selected scope"
              isInline
            />
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          isLoading={submitting}
          isDisabled={disabledSubmit}
          onClick={async () => {
            setSubmitting(true)
            try {
              await onSubmit(scope === 'global' ? null : scope, role)
            } finally {
              setSubmitting(false)
            }
          }}
        >
          Grant
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={submitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
