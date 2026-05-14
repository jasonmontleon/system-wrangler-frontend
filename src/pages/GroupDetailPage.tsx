// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Bullseye,
  Checkbox,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateBody,
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
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  listSystems,
  type System,
  type SystemStatus,
} from '../api/systems'
import { type Group, setSystemGroup } from '../api/groups'
import { useEventStream } from '../hooks/useEventStream'

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

type SortKey = 'name' | 'hostname' | 'status' | 'lastSeen' | 'createdAt'
type SortDir = 'asc' | 'desc'

type Confirm =
  | { kind: 'remove-one'; system: System }
  | { kind: 'remove-bulk'; ids: string[] }

type GroupDetailPageProps = {
  group: Group
  onBack: () => void
}

export default function GroupDetailPage({ group, onBack }: GroupDetailPageProps) {
  const [systems, setSystems] = useState<System[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    hostname: '',
    status: '',
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

  const refresh = useCallback(async () => {
    try {
      const data = await listSystems()
      setSystems(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

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

  const members = useMemo(
    () => (systems ?? []).filter((s) => s.groupId === group.id),
    [systems, group.id],
  )

  const filtered = useMemo(() => {
    const n = filters.name.trim().toLowerCase()
    const h = filters.hostname.trim().toLowerCase()
    const st = filters.status.trim().toLowerCase()
    const ls = filters.lastSeen.trim().toLowerCase()
    const c = filters.createdAt.trim().toLowerCase()
    return members.filter((row) => {
      if (n && !row.name.toLowerCase().includes(n)) return false
      if (h && !row.hostname.toLowerCase().includes(h)) return false
      if (st) {
        const label = STATUS_LABELS[row.status]?.text.toLowerCase() ?? row.status
        if (!label.includes(st)) return false
      }
      if (ls && !formatLastSeen(row.lastSeen).toLowerCase().includes(ls))
        return false
      if (
        c &&
        !new Date(row.createdAt).toLocaleString().toLowerCase().includes(c)
      )
        return false
      return true
    })
  }, [members, filters])

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
    const valid = new Set(members.map((s) => s.id))
    setSelected((prev) => {
      const next = new Set<string>()
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [members])

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

  const removeFromGroup = async (id: string) => {
    setActionError(null)
    try {
      await setSystemGroup(id, null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    }
  }

  const ungrouped = useMemo(
    () => (systems ?? []).filter((s) => !s.groupId),
    [systems],
  )

  const selectionCount = selected.size

  return (
    <>
      <PageSection>
        <Breadcrumb>
          <BreadcrumbItem to="#" onClick={onBack}>
            System Groups
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{group.name}</BreadcrumbItem>
        </Breadcrumb>
      </PageSection>

      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1">{group.name}</Title>
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
                    Add systems
                  </DropdownItem>
                  <DropdownItem
                    value="remove"
                    key="remove"
                    isDisabled={selectionCount === 0}
                  >
                    Remove selected from group
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
              <Button
                variant="plain"
                onClick={() => setActionError(null)}
                aria-label="Dismiss"
              >
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
        {systems !== null && members.length === 0 && (
          <EmptyState titleText="No systems in this group" headingLevel="h2">
            <EmptyStateBody>
              Add systems from the Actions menu in the toolbar above.
            </EmptyStateBody>
          </EmptyState>
        )}
        {systems !== null && members.length > 0 && (
          <Table aria-label={`Systems in ${group.name}`} variant="compact">
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: () => toggleAllVisible(!allVisibleSelected),
                    isSelected: allVisibleSelected,
                    isDisabled: visible.length === 0,
                  }}
                />
                <Th width={25} sort={sortFor('name', 1)}>
                  Name
                </Th>
                <Th width={25} sort={sortFor('hostname', 2)}>
                  Hostname
                </Th>
                <Th width={15} sort={sortFor('status', 3)}>
                  Status
                </Th>
                <Th width={20} sort={sortFor('lastSeen', 4)}>
                  Last seen
                </Th>
                <Th width={10} sort={sortFor('createdAt', 5)}>
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
                    <Td dataLabel="Last seen">{formatLastSeen(s.lastSeen)}</Td>
                    <Td dataLabel="Added">
                      {new Date(s.createdAt).toLocaleString()}
                    </Td>
                    <Td dataLabel="Actions" isActionCell>
                      <ActionsColumn
                        items={[
                          {
                            title: `Remove ${s.name} from group`,
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

      {systems !== null && members.length > 0 && pageSize !== 'all' && (
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

      <AddSystemsModal
        isOpen={isAddOpen}
        candidates={ungrouped}
        groupName={group.name}
        onClose={() => setAddOpen(false)}
        onAdded={async (ids) => {
          setAddOpen(false)
          setActionError(null)
          try {
            for (const id of ids) {
              await setSystemGroup(id, group.id)
            }
          } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err))
          }
          await refresh()
        }}
      />

      <ConfirmRemoveModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          if (confirm.kind === 'remove-one') {
            await removeFromGroup(confirm.system.id)
          } else {
            for (const id of confirm.ids) {
              await removeFromGroup(id)
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

type AddSystemsModalProps = {
  isOpen: boolean
  candidates: System[]
  groupName: string
  onClose: () => void
  onAdded: (ids: string[]) => void | Promise<void>
}

function AddSystemsModal({
  isOpen,
  candidates,
  groupName,
  onClose,
  onAdded,
}: AddSystemsModalProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setPicked(new Set())
      setFilter('')
      setSubmitting(false)
    }
  }, [isOpen])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.hostname.toLowerCase().includes(q),
    )
  }, [candidates, filter])

  const toggle = (id: string, checked: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const onSubmit = async () => {
    setSubmitting(true)
    try {
      await onAdded(Array.from(picked))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="add-systems-title"
    >
      <ModalHeader
        title={`Add systems to ${groupName}`}
        labelId="add-systems-title"
      />
      <ModalBody>
        <SearchInput
          aria-label="Filter systems"
          placeholder="Filter by name or hostname"
          value={filter}
          onChange={(_, v) => setFilter(v)}
          onClear={() => setFilter('')}
        />
        {candidates.length === 0 ? (
          <EmptyState titleText="No ungrouped systems" headingLevel="h3">
            <EmptyStateBody>
              Every system already belongs to a group.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <div style={{ maxHeight: '20rem', overflowY: 'auto', marginTop: '0.5rem' }}>
            {filtered.map((c) => (
              <Checkbox
                key={c.id}
                id={`add-system-${c.id}`}
                label={`${c.name} (${c.hostname})`}
                isChecked={picked.has(c.id)}
                onChange={(_, checked) => toggle(c.id, checked)}
              />
            ))}
            {filtered.length === 0 && (
              <p style={{ marginTop: '0.5rem' }}>No matches.</p>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={() => void onSubmit()}
          isDisabled={submitting || picked.size === 0}
          isLoading={submitting}
        >
          Add {picked.size > 0 ? `(${picked.size})` : ''}
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

function ConfirmRemoveModal({
  confirm,
  onCancel,
  onConfirm,
}: ConfirmRemoveModalProps) {
  const isOpen = confirm !== null
  const isBulk = confirm?.kind === 'remove-bulk'
  const title = isBulk ? 'Remove from group?' : 'Remove from group?'
  const body = isBulk
    ? `Remove ${confirm && confirm.kind === 'remove-bulk' ? confirm.ids.length : 0} systems from this group? The systems themselves are not deleted.`
    : `Remove ${confirm?.kind === 'remove-one' ? confirm.system.name : ''} from this group? The system itself is not deleted.`
  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onCancel}
      aria-labelledby="remove-from-group-title"
    >
      <ModalHeader title={title} labelId="remove-from-group-title" />
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
