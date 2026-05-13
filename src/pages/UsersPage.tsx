// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { ApiError } from '../api/systems'
import {
  createUser,
  listUsers,
  setUserDisabled,
  type User,
} from '../api/users'

type Props = {
  currentUserId: string
}

export default function UsersPage({ currentUserId }: Props) {
  const [users, setUsers] = useState<User[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await listUsers()
      setUsers(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleDisabled = async (u: User) => {
    setActionError(null)
    try {
      await setUserDisabled(u.id, !u.disabled)
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1">Users</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                New user
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      <PageSection>
        {loadError && (
          <Alert variant="danger" title="Could not load users" isInline>
            {loadError}
          </Alert>
        )}
        {actionError && (
          <Alert
            variant="danger"
            title="Action failed"
            isInline
            actionClose={
              <Button variant="plain" onClick={() => setActionError(null)} aria-label="Dismiss">
                ×
              </Button>
            }
          >
            {actionError}
          </Alert>
        )}
        {!loadError && users === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {users !== null && users.length === 0 && (
          <EmptyState titleText="No users yet" headingLevel="h2">
            <EmptyStateBody>
              Add a user with the button in the toolbar above.
            </EmptyStateBody>
          </EmptyState>
        )}
        {users !== null && users.length > 0 && (
          <Table aria-label="Users" variant="compact">
            <Thead>
              <Tr>
                <Th width={30}>Username</Th>
                <Th width={20}>Status</Th>
                <Th width={25}>Created</Th>
                <Th width={25} screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUserId
                return (
                  <Tr key={u.id}>
                    <Td dataLabel="Username" modifier="truncate">
                      {u.username}
                      {isSelf && (
                        <Label isCompact style={{ marginLeft: 8 }}>
                          You
                        </Label>
                      )}
                    </Td>
                    <Td dataLabel="Status">
                      {u.disabled ? (
                        <Label color="red" isCompact>
                          Disabled
                        </Label>
                      ) : (
                        <Label color="green" isCompact>
                          Active
                        </Label>
                      )}
                    </Td>
                    <Td dataLabel="Created">
                      {new Date(u.createdAt).toLocaleString()}
                    </Td>
                    <Td dataLabel="Actions" isActionCell>
                      <Button
                        variant="link"
                        isDanger={!u.disabled}
                        isDisabled={isSelf}
                        onClick={() => void toggleDisabled(u)}
                        aria-label={
                          u.disabled
                            ? `Enable ${u.username}`
                            : `Disable ${u.username}`
                        }
                      >
                        {u.disabled ? 'Enable' : 'Disable'}
                      </Button>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>

      <AddUserModal
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false)
          await refresh()
        }}
      />
    </>
  )
}

type AddUserModalProps = {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function AddUserModal({ isOpen, onClose, onCreated }: AddUserModalProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setUsername('')
      setPassword('')
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [isOpen])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createUser({ username, password })
      await onCreated()
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="add-user-title"
    >
      <ModalHeader title="New user" labelId="add-user-title" />
      <ModalBody>
        <Form id="add-user-form" onSubmit={onSubmit}>
          <FormGroup label="Username" fieldId="add-user-username" isRequired>
            <TextInput
              id="add-user-username"
              value={username}
              onChange={(_, v) => setUsername(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
            />
          </FormGroup>
          <FormGroup label="Initial password" fieldId="add-user-password" isRequired>
            <TextInput
              id="add-user-password"
              type="password"
              value={password}
              onChange={(_, v) => setPassword(v)}
              isRequired
              isDisabled={submitting}
              placeholder="At least 8 characters"
            />
          </FormGroup>
          {submitError && (
            <Alert variant="danger" title="Could not create user" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="add-user-form"
          variant="primary"
          isLoading={submitting}
          isDisabled={submitting || !username || password.length < 8}
        >
          Create
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={submitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
