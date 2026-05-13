// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Bullseye,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  Label,
  MenuToggle,
  type MenuToggleElement,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  SearchInput,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { ApiError } from '../api/systems'
import {
  createUser,
  deleteUser,
  listUsers,
  setUserDisabled,
  type User,
} from '../api/users'

type Props = {
  currentUserId: string
}

type PageSize = 25 | 50 | 100 | 'all'
const PAGE_SIZE_OPTIONS: { value: PageSize; label: string }[] = [
  { value: 25, label: '25 per page' },
  { value: 50, label: '50 per page' },
  { value: 100, label: '100 per page' },
  { value: 'all', label: 'All' },
]

type SortKey = 'username' | 'status' | 'createdAt'
type SortDir = 'asc' | 'desc'

type ConfirmKind = 'remove-one' | 'remove-bulk'
type Confirm =
  | { kind: 'remove-one'; user: User }
  | { kind: 'remove-bulk'; ids: string[] }

export default function UsersPage({ currentUserId }: Props) {
  const [users, setUsers] = useState<User[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const [filters, setFilters] = useState<Record<string, string>>({
    username: '',
    status: '',
    createdAt: '',
  })
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [page, setPage] = useState(1)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  const filtered = useMemo(() => {
    if (!users) return []
    const u = filters.username.trim().toLowerCase()
    const st = filters.status.trim().toLowerCase()
    const c = filters.createdAt.trim().toLowerCase()
    return users.filter((row) => {
      if (u && !row.username.toLowerCase().includes(u)) return false
      if (st) {
        const label = row.disabled ? 'disabled' : 'active'
        if (!label.includes(st)) return false
      }
      if (c) {
        const formatted = new Date(row.createdAt).toLocaleString().toLowerCase()
        if (!formatted.includes(c)) return false
      }
      return true
    })
  }, [users, filters])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortKey === 'username') {
        av = a.username.toLowerCase()
        bv = b.username.toLowerCase()
      } else if (sortKey === 'status') {
        av = a.disabled ? 1 : 0
        bv = b.disabled ? 1 : 0
      } else {
        av = new Date(a.createdAt).getTime()
        bv = new Date(b.createdAt).getTime()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [filtered, sortKey, sortDir])

  const pageCount =
    pageSize === 'all' ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible =
    pageSize === 'all'
      ? sorted
      : sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => {
    setPage(1)
  }, [filters, sortKey, sortDir, pageSize])

  useEffect(() => {
    if (!users) return
    const valid = new Set(users.map((u) => u.id))
    setSelected((prev) => {
      const next = new Set<string>()
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [users])

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortFor = (key: SortKey, columnIndex: number) => ({
    sortBy: {
      index: sortKey === key ? columnIndex : undefined,
      direction: sortKey === key ? sortDir : undefined,
      defaultDirection: 'asc' as const,
    },
    onSort: () => onSort(key),
    columnIndex,
  })

  const toggleRow = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectableVisible = visible.filter((u) => u.id !== currentUserId)
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((u) => selected.has(u.id))

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      selectableVisible.forEach((u) => {
        if (checked) next.add(u.id)
        else next.delete(u.id)
      })
      return next
    })
  }

  const setDisabled = async (id: string, disabled: boolean) => {
    setActionError(null)
    try {
      await setUserDisabled(id, disabled)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async (id: string) => {
    setActionError(null)
    try {
      await deleteUser(id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const runBulk = async (action: 'disable' | 'enable' | 'remove') => {
    const ids = Array.from(selected).filter((id) => id !== currentUserId)
    if (ids.length === 0) return
    setActionError(null)
    if (action === 'disable' || action === 'enable') {
      for (const id of ids) {
        try {
          await setUserDisabled(id, action === 'disable')
        } catch (err) {
          setActionError(err instanceof Error ? err.message : String(err))
        }
      }
    } else {
      for (const id of ids) {
        try {
          await deleteUser(id)
        } catch (err) {
          setActionError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    setSelected(new Set())
    await refresh()
  }

  const selectionCount = Array.from(selected).filter(
    (id) => id !== currentUserId,
  ).length

  return (
    <>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1">Users</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Dropdown
                isOpen={actionsOpen}
                onSelect={(_, value) => {
                  setActionsOpen(false)
                  if (value === 'add') setAddOpen(true)
                  if (value === 'disable') void runBulk('disable')
                  if (value === 'enable') void runBulk('enable')
                  if (value === 'remove') {
                    const ids = Array.from(selected).filter(
                      (id) => id !== currentUserId,
                    )
                    if (ids.length > 0) {
                      setConfirm({ kind: 'remove-bulk', ids })
                    }
                  }
                }}
                onOpenChange={(open) => setActionsOpen(open)}
                toggle={(ref: React.Ref<MenuToggleElement>) => (
                  <MenuToggle
                    ref={ref}
                    isExpanded={actionsOpen}
                    onClick={() => setActionsOpen((o) => !o)}
                    variant="primary"
                    aria-label="Actions"
                  >
                    Actions
                  </MenuToggle>
                )}
              >
                <DropdownList>
                  <DropdownItem value="add" key="add">
                    New user
                  </DropdownItem>
                  <DropdownItem
                    value="disable"
                    key="disable"
                    isDisabled={selectionCount === 0}
                  >
                    Disable selected
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                  <DropdownItem
                    value="enable"
                    key="enable"
                    isDisabled={selectionCount === 0}
                  >
                    Enable selected
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                  <DropdownItem
                    value="remove"
                    key="remove"
                    isDisabled={selectionCount === 0}
                  >
                    Remove selected
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                </DropdownList>
              </Dropdown>
            </ToolbarItem>
            <ToolbarItem>
              <Select
                isOpen={sizeOpen}
                selected={pageSize}
                onSelect={(_, value) => {
                  setPageSize(value as PageSize)
                  setSizeOpen(false)
                }}
                onOpenChange={(open) => setSizeOpen(open)}
                toggle={(ref: React.Ref<MenuToggleElement>) => (
                  <MenuToggle
                    ref={ref}
                    isExpanded={sizeOpen}
                    onClick={() => setSizeOpen((o) => !o)}
                    aria-label="Page size"
                  >
                    {PAGE_SIZE_OPTIONS.find((p) => p.value === pageSize)?.label}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  {PAGE_SIZE_OPTIONS.map((p) => (
                    <SelectOption key={String(p.value)} value={p.value}>
                      {p.label}
                    </SelectOption>
                  ))}
                </SelectList>
              </Select>
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
              Add a user from the Actions menu in the toolbar above.
            </EmptyStateBody>
          </EmptyState>
        )}
        {users !== null && users.length > 0 && (
          <Table aria-label="Users" variant="compact">
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: () => toggleAllVisible(!allVisibleSelected),
                    isSelected: allVisibleSelected,
                    isDisabled: selectableVisible.length === 0,
                  }}
                />
                <Th width={30} sort={sortFor('username', 1)}>
                  Username
                </Th>
                <Th width={20} sort={sortFor('status', 2)}>
                  Status
                </Th>
                <Th width={25} sort={sortFor('createdAt', 3)}>
                  Created
                </Th>
                <Th width={25} screenReaderText="Actions" />
              </Tr>
              <Tr>
                <Th screenReaderText="Filter spacer" />
                <Th>
                  <SearchInput
                    aria-label="Filter username"
                    placeholder="Filter username"
                    value={filters.username}
                    onChange={(_, v) => setFilters((f) => ({ ...f, username: v }))}
                    onClear={() => setFilters((f) => ({ ...f, username: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter status"
                    placeholder="active / disabled"
                    value={filters.status}
                    onChange={(_, v) => setFilters((f) => ({ ...f, status: v }))}
                    onClear={() => setFilters((f) => ({ ...f, status: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter created"
                    placeholder="Filter created"
                    value={filters.createdAt}
                    onChange={(_, v) => setFilters((f) => ({ ...f, createdAt: v }))}
                    onClear={() => setFilters((f) => ({ ...f, createdAt: '' }))}
                  />
                </Th>
                <Th screenReaderText="Actions spacer" />
              </Tr>
            </Thead>
            <Tbody>
              {visible.map((u, rowIndex) => {
                const isSelf = u.id === currentUserId
                return (
                  <Tr key={u.id}>
                    <Td
                      select={{
                        rowIndex,
                        onSelect: (_, isSelecting) =>
                          toggleRow(u.id, isSelecting),
                        isSelected: selected.has(u.id),
                        isDisabled: isSelf,
                      }}
                    />
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
                      <ActionsColumn
                        isDisabled={isSelf}
                        items={[
                          {
                            title: u.disabled
                              ? `Enable ${u.username}`
                              : `Disable ${u.username}`,
                            onClick: () => void setDisabled(u.id, !u.disabled).then(refresh),
                          },
                          {
                            title: `Remove ${u.username}`,
                            onClick: () =>
                              setConfirm({ kind: 'remove-one', user: u }),
                          },
                        ]}
                      />
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>

      {users !== null && users.length > 0 && pageSize !== 'all' && (
        <PageSection>
          <Toolbar>
            <ToolbarContent>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  isDisabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  isDisabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Next
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                Page {safePage} of {pageCount}
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        </PageSection>
      )}

      <AddUserModal
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false)
          await refresh()
        }}
      />

      <ConfirmRemoveModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          if (confirm.kind === 'remove-one') {
            await remove(confirm.user.id)
          } else {
            for (const id of confirm.ids) {
              await remove(id)
            }
            setSelected(new Set())
          }
          setConfirm(null)
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

type ConfirmRemoveModalProps = {
  confirm: Confirm | null
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

function ConfirmRemoveModal({ confirm, onCancel, onConfirm }: ConfirmRemoveModalProps) {
  const isOpen = confirm !== null
  const isBulk = confirm?.kind === 'remove-bulk'
  const title = isBulk ? 'Remove users?' : 'Remove user?'
  const body = isBulk
    ? `Permanently remove ${(confirm as { kind: ConfirmKind; ids: string[] } | null)?.ids.length ?? 0} users? This cannot be undone.`
    : `Permanently remove ${confirm?.kind === 'remove-one' ? confirm.user.username : ''}? This cannot be undone.`
  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onCancel}
      aria-labelledby="remove-user-title"
    >
      <ModalHeader title={title} labelId="remove-user-title" />
      <ModalBody>{body}</ModalBody>
      <ModalFooter>
        <Button variant="danger" onClick={() => void onConfirm()}>
          Remove
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
