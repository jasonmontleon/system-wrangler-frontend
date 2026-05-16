// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  ApiError,
  createSystem,
  deleteSystem,
  listSystems,
  type System,
  type SystemStatus,
} from '../api/systems'
import { listGroups, type Group } from '../api/groups'
import { useEventStream } from '../hooks/useEventStream'
import { canAdminGroup, isGlobalAdmin, useScope } from '../hooks/useScope'
import SystemCredentialsModal from '../components/SystemCredentialsModal'

const STATUS_LABELS: Record<
  SystemStatus,
  { color: 'green' | 'red' | 'grey'; text: string }
> = {
  reachable: { color: 'green', text: 'Reachable' },
  unreachable: { color: 'red', text: 'Unreachable' },
  unprobed: { color: 'grey', text: 'Unprobed' },
}

function formatLastSeen(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

type PageSize = 25 | 50 | 100 | 'all'
const PAGE_SIZE_OPTIONS: { value: PageSize; label: string }[] = [
  { value: 25, label: '25 per page' },
  { value: 50, label: '50 per page' },
  { value: 100, label: '100 per page' },
  { value: 'all', label: 'All' },
]

type SortKey =
  | 'name'
  | 'hostname'
  | 'status'
  | 'group'
  | 'lastSeen'
  | 'createdAt'
type SortDir = 'asc' | 'desc'

type Confirm =
  | { kind: 'remove-one'; system: System }
  | { kind: 'remove-bulk'; ids: string[] }

export default function SystemsPage() {
  const [systems, setSystems] = useState<System[] | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    hostname: '',
    status: '',
    group: '',
    lastSeen: '',
    createdAt: '',
  })
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [page, setPage] = useState(1)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [credModalFor, setCredModalFor] = useState<System | null>(null)

  // Scope is consulted only for the per-row "Credentials" action so
  // Group Admins of the system's group can manage credentials too.
  // Existing actions on this page (Remove) intentionally keep their
  // pre-RBAC visibility — narrowing them is out of scope here.
  const { state: scopeState } = useScope()
  const canManageCredentialsFor = (s: System): boolean => {
    if (isGlobalAdmin(scopeState)) return true
    if (!s.groupId) return false
    return canAdminGroup(scopeState, s.groupId)
  }

  const refresh = useCallback(async () => {
    try {
      const data = await listSystems()
      setSystems(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Group names are loaded once on mount, decoupled from the systems
  // refresh cycle. The Group column is best-effort: if the call fails,
  // every row simply shows '—' rather than blocking the Systems list.
  useEffect(() => {
    let cancelled = false
    listGroups()
      .then((gs) => {
        if (!cancelled) setGroups(gs)
      })
      .catch(() => {
        // intentionally ignored
      })
    return () => {
      cancelled = true
    }
  }, [])

  const groupNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups) m.set(g.id, g.name)
    return m
  }, [groups])

  const groupNameFor = useCallback(
    (s: System): string =>
      s.groupId ? (groupNameById.get(s.groupId) ?? '') : '',
    [groupNameById],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEventStream(
    useCallback(
      (event) => {
        if (event.type !== 'systems.changed') return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          void refresh()
        }, 200)
      },
      [refresh],
    ),
  )
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const filtered = useMemo(() => {
    if (!systems) return []
    const n = filters.name.trim().toLowerCase()
    const h = filters.hostname.trim().toLowerCase()
    const st = filters.status.trim().toLowerCase()
    const gr = filters.group.trim().toLowerCase()
    const ls = filters.lastSeen.trim().toLowerCase()
    const c = filters.createdAt.trim().toLowerCase()
    return systems.filter((row) => {
      if (n && !row.name.toLowerCase().includes(n)) return false
      if (h && !row.hostname.toLowerCase().includes(h)) return false
      if (st) {
        const label = STATUS_LABELS[row.status]?.text.toLowerCase() ?? row.status
        if (!label.includes(st)) return false
      }
      if (gr) {
        const display = (groupNameFor(row) || '—').toLowerCase()
        if (!display.includes(gr)) return false
      }
      if (ls) {
        if (!formatLastSeen(row.lastSeen).toLowerCase().includes(ls)) return false
      }
      if (c) {
        if (!new Date(row.createdAt).toLocaleString().toLowerCase().includes(c))
          return false
      }
      return true
    })
  }, [systems, filters, groupNameFor])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortKey === 'name') {
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
      } else if (sortKey === 'hostname') {
        av = a.hostname.toLowerCase()
        bv = b.hostname.toLowerCase()
      } else if (sortKey === 'status') {
        av = a.status
        bv = b.status
      } else if (sortKey === 'group') {
        av = groupNameFor(a).toLowerCase()
        bv = groupNameFor(b).toLowerCase()
      } else if (sortKey === 'lastSeen') {
        av = a.lastSeen ? new Date(a.lastSeen).getTime() : 0
        bv = b.lastSeen ? new Date(b.lastSeen).getTime() : 0
      } else {
        av = new Date(a.createdAt).getTime()
        bv = new Date(b.createdAt).getTime()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [filtered, sortKey, sortDir, groupNameFor])

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
    if (!systems) return
    const valid = new Set(systems.map((s) => s.id))
    setSelected((prev) => {
      const next = new Set<string>()
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [systems])

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

  const allVisibleSelected =
    visible.length > 0 && visible.every((s) => selected.has(s.id))

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      visible.forEach((s) => {
        if (checked) next.add(s.id)
        else next.delete(s.id)
      })
      return next
    })
  }

  const removeOne = async (id: string) => {
    setActionError(null)
    try {
      await deleteSystem(id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const selectionCount = selected.size

  return (
    <>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1">Systems</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Dropdown
                isOpen={actionsOpen}
                onSelect={(_, value) => {
                  setActionsOpen(false)
                  if (value === 'add') setAddOpen(true)
                  if (value === 'remove') {
                    const ids = Array.from(selected)
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
                    Add system
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
          <Alert variant="danger" title="Could not load systems" isInline>
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
        {!loadError && systems === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {systems !== null && systems.length === 0 && (
          <EmptyState titleText="No systems yet" headingLevel="h2">
            <EmptyStateBody>
              Add your first system from the Actions menu in the toolbar above.
            </EmptyStateBody>
          </EmptyState>
        )}
        {systems !== null && systems.length > 0 && (
          <Table aria-label="Systems" variant="compact">
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: () => toggleAllVisible(!allVisibleSelected),
                    isSelected: allVisibleSelected,
                    isDisabled: visible.length === 0,
                  }}
                />
                <Th width={20} sort={sortFor('name', 1)}>
                  Name
                </Th>
                <Th width={20} sort={sortFor('hostname', 2)}>
                  Hostname
                </Th>
                <Th width={10} sort={sortFor('status', 3)}>
                  Status
                </Th>
                <Th width={15} sort={sortFor('group', 4)}>
                  Group
                </Th>
                <Th width={15} sort={sortFor('lastSeen', 5)}>
                  Last seen
                </Th>
                <Th width={10} sort={sortFor('createdAt', 6)}>
                  Added
                </Th>
                <Th width={10} screenReaderText="Actions" />
              </Tr>
              <Tr>
                <Th screenReaderText="Filter spacer" />
                <Th>
                  <SearchInput
                    aria-label="Filter name"
                    placeholder="Filter name"
                    value={filters.name}
                    onChange={(_, v) => setFilters((f) => ({ ...f, name: v }))}
                    onClear={() => setFilters((f) => ({ ...f, name: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter hostname"
                    placeholder="Filter hostname"
                    value={filters.hostname}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, hostname: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, hostname: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter status"
                    placeholder="Filter status"
                    value={filters.status}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, status: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, status: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter group"
                    placeholder="Filter group"
                    value={filters.group}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, group: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, group: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter last seen"
                    placeholder="Filter last seen"
                    value={filters.lastSeen}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, lastSeen: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, lastSeen: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter added"
                    placeholder="Filter added"
                    value={filters.createdAt}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, createdAt: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, createdAt: '' }))}
                  />
                </Th>
                <Th screenReaderText="Actions spacer" />
              </Tr>
            </Thead>
            <Tbody>
              {visible.map((s, rowIndex) => {
                const label = STATUS_LABELS[s.status] ?? STATUS_LABELS.unprobed
                return (
                  <Tr key={s.id}>
                    <Td
                      select={{
                        rowIndex,
                        onSelect: (_, isSelecting) =>
                          toggleRow(s.id, isSelecting),
                        isSelected: selected.has(s.id),
                      }}
                    />
                    <Td dataLabel="Name" modifier="truncate">
                      {s.name}
                    </Td>
                    <Td dataLabel="Hostname" modifier="truncate">
                      {s.hostname}
                    </Td>
                    <Td dataLabel="Status">
                      <Label color={label.color} isCompact>
                        {label.text}
                      </Label>
                    </Td>
                    <Td dataLabel="Group">{groupNameFor(s) || '—'}</Td>
                    <Td dataLabel="Last seen">{formatLastSeen(s.lastSeen)}</Td>
                    <Td dataLabel="Added">
                      {new Date(s.createdAt).toLocaleString()}
                    </Td>
                    <Td dataLabel="Actions" isActionCell>
                      <ActionsColumn
                        items={[
                          ...(canManageCredentialsFor(s)
                            ? [
                                {
                                  title: 'Credentials',
                                  onClick: () => setCredModalFor(s),
                                },
                              ]
                            : []),
                          {
                            title: `Remove ${s.name}`,
                            onClick: () =>
                              setConfirm({ kind: 'remove-one', system: s }),
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

      {systems !== null && systems.length > 0 && pageSize !== 'all' && (
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

      <AddSystemModal
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false)
          await refresh()
        }}
      />

      {credModalFor && (
        <SystemCredentialsModal
          system={credModalFor}
          isOpen={true}
          onClose={() => setCredModalFor(null)}
        />
      )}

      <ConfirmRemoveModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          if (confirm.kind === 'remove-one') {
            await removeOne(confirm.system.id)
          } else {
            for (const id of confirm.ids) {
              await removeOne(id)
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

type AddSystemModalProps = {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function AddSystemModal({ isOpen, onClose, onCreated }: AddSystemModalProps) {
  const [hostname, setHostname] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setHostname('')
      setName('')
      setNameEdited(false)
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [isOpen])

  const onHostnameChange = (v: string) => {
    setHostname(v)
    if (!nameEdited) setName(v)
  }

  const onNameChange = (v: string) => {
    setName(v)
    setNameEdited(true)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createSystem({ name, hostname })
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
      aria-labelledby="add-system-title"
    >
      <ModalHeader title="Add system" labelId="add-system-title" />
      <ModalBody>
        <Form id="add-system-form" onSubmit={onSubmit}>
          <FormGroup label="Hostname" fieldId="add-system-hostname" isRequired>
            <TextInput
              id="add-system-hostname"
              value={hostname}
              onChange={(_, v) => onHostnameChange(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
              placeholder="server.example.com or 10.0.0.5"
            />
          </FormGroup>
          <FormGroup label="Name" fieldId="add-system-name" isRequired>
            <TextInput
              id="add-system-name"
              value={name}
              onChange={(_, v) => onNameChange(v)}
              isRequired
              isDisabled={submitting}
              placeholder="Defaults to hostname"
            />
          </FormGroup>
          {submitError && (
            <Alert variant="danger" title="Could not add system" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="add-system-form"
          variant="primary"
          isLoading={submitting}
          isDisabled={submitting || !hostname || !name}
        >
          Add
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
  const title = isBulk ? 'Remove systems?' : 'Remove system?'
  const body = isBulk
    ? `Permanently remove ${confirm && confirm.kind === 'remove-bulk' ? confirm.ids.length : 0} systems? This cannot be undone.`
    : `Permanently remove ${confirm?.kind === 'remove-one' ? confirm.system.name : ''}? This cannot be undone.`
  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onCancel}
      aria-labelledby="remove-system-title"
    >
      <ModalHeader title={title} labelId="remove-system-title" />
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
