// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  MenuToggle,
  type MenuToggleElement,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  grantGroupRole,
  listGroupRoleAssignments,
  revokeGroupRole,
  type Role,
  type RoleAssignment,
} from '../api/roles'
import { listUsers, type User } from '../api/users'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  operator: 'Operator',
  auditor: 'Auditor',
}

type Props = {
  groupId: string
  groupName: string
  // canAdmin gates the Add user button and the row Actions menu.
  // When false the tab is read-only (Operator / Auditor view).
  canAdmin: boolean
  // canGrantAdminRole, when true, lets the picker include the Admin
  // role choice. Per research/rbac.md, Group Admin cannot grant Admin
  // — only Global Admin can. The control hides the option for
  // Group Admin callers; the backend remains the source of truth.
  canGrantAdminRole: boolean
}

export default function GroupRolesTab({
  groupId,
  groupName,
  canAdmin,
  canGrantAdminRole,
}: Props) {
  const [assignments, setAssignments] = useState<RoleAssignment[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [users, setUsers] = useState<User[] | null>(null)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const rows = await listGroupRoleAssignments(groupId)
      setAssignments(rows)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [groupId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Users list is only needed when adding — fetch lazily on first
  // open so non-admins (who never see the Add button) don't make a
  // 403'd request.
  const ensureUsers = useCallback(async () => {
    if (users !== null) return
    try {
      const list = await listUsers()
      setUsers(list)
      setUsersError(null)
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : String(err))
    }
  }, [users])

  const revoke = async (a: RoleAssignment) => {
    setActionError(null)
    try {
      await revokeGroupRole(groupId, a.userId, a.role)
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Toolbar>
        <ToolbarContent>
          {canAdmin && (
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Button
                variant="primary"
                onClick={() => {
                  setAddOpen(true)
                  void ensureUsers()
                }}
              >
                Add user
              </Button>
            </ToolbarItem>
          )}
        </ToolbarContent>
      </Toolbar>
      {loadError && (
        <Alert variant="danger" title="Could not load role assignments" isInline>
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
      {assignments !== null && assignments.length === 0 && (
        <EmptyState titleText="No role assignments on this group" headingLevel="h3">
          <EmptyStateBody>
            {canAdmin
              ? 'Use Add user to grant a role on this group.'
              : 'No users have been granted a role on this group yet.'}
          </EmptyStateBody>
        </EmptyState>
      )}
      {assignments !== null && assignments.length > 0 && (
        <Table aria-label={`Role assignments on ${groupName}`} variant="compact">
          <Thead>
            <Tr>
              <Th>Username</Th>
              <Th>Role</Th>
              {canAdmin && <Th screenReaderText="Actions" />}
            </Tr>
          </Thead>
          <Tbody>
            {assignments.map((a) => (
              <Tr key={`${a.userId}:${a.role}`}>
                <Td dataLabel="Username">{a.username || a.userId}</Td>
                <Td dataLabel="Role">{ROLE_LABEL[a.role]}</Td>
                {canAdmin && (
                  <Td dataLabel="Actions" isActionCell>
                    <ActionsColumn
                      items={[
                        {
                          title: `Revoke ${ROLE_LABEL[a.role]} from ${a.username || a.userId}`,
                          // Group Admin cannot revoke Admin (mirror of the grant rule).
                          isDisabled: !canGrantAdminRole && a.role === 'admin',
                          onClick: () => void revoke(a),
                        },
                      ]}
                    />
                  </Td>
                )}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      <AddRoleModal
        isOpen={isAddOpen}
        groupName={groupName}
        users={users}
        usersError={usersError}
        canGrantAdminRole={canGrantAdminRole}
        existing={assignments ?? []}
        onClose={() => setAddOpen(false)}
        onSubmit={async (userId, role) => {
          setActionError(null)
          try {
            await grantGroupRole(groupId, userId, role)
            setAddOpen(false)
            await refresh()
          } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err))
          }
        }}
      />
    </>
  )
}

type AddRoleModalProps = {
  isOpen: boolean
  groupName: string
  users: User[] | null
  usersError: string | null
  canGrantAdminRole: boolean
  existing: RoleAssignment[]
  onClose: () => void
  onSubmit: (userId: string, role: Role) => void | Promise<void>
}

function AddRoleModal({
  isOpen,
  groupName,
  users,
  usersError,
  canGrantAdminRole,
  existing,
  onClose,
  onSubmit,
}: AddRoleModalProps) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<Role>('operator')
  const [submitting, setSubmitting] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setUserId('')
      setRole('operator')
      setSubmitting(false)
    }
  }, [isOpen])

  const roleChoices: Role[] = useMemo(
    () => (canGrantAdminRole ? ['admin', 'operator', 'auditor'] : ['operator', 'auditor']),
    [canGrantAdminRole],
  )

  // Filter out users that already hold this role on the group so the
  // backend's 409 duplicate never lands as a confusing error.
  const userChoices = useMemo(() => {
    const taken = new Set(
      existing.filter((a) => a.role === role).map((a) => a.userId),
    )
    return (users ?? []).filter((u) => !u.disabled && !taken.has(u.id))
  }, [users, existing, role])

  const selectedUsername =
    userChoices.find((u) => u.id === userId)?.username ?? 'Select a user'

  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="add-role-title"
    >
      <ModalHeader
        title={`Grant role on ${groupName}`}
        labelId="add-role-title"
      />
      <ModalBody>
        {usersError && (
          <Alert variant="danger" title="Could not load users" isInline>
            {usersError}
          </Alert>
        )}
        <Form id="add-role-form">
          <FormGroup label="User" fieldId="add-role-user" isRequired>
            <Select
              id="add-role-user"
              isOpen={userOpen}
              selected={userId}
              onSelect={(_, value) => {
                setUserId(String(value ?? ''))
                setUserOpen(false)
              }}
              onOpenChange={(open) => setUserOpen(open)}
              toggle={(ref: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={ref}
                  isExpanded={userOpen}
                  onClick={() => setUserOpen((o) => !o)}
                  isDisabled={users === null || userChoices.length === 0}
                  aria-label="User picker"
                >
                  {selectedUsername}
                </MenuToggle>
              )}
            >
              <SelectList>
                {userChoices.map((u) => (
                  <SelectOption key={u.id} value={u.id}>
                    {u.username}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </FormGroup>
          <FormGroup label="Role" fieldId="add-role-role" isRequired>
            <Select
              id="add-role-role"
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
                {roleChoices.map((r) => (
                  <SelectOption key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          isLoading={submitting}
          isDisabled={submitting || !userId}
          onClick={async () => {
            setSubmitting(true)
            try {
              await onSubmit(userId, role)
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
