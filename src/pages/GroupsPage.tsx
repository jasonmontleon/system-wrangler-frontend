// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
  createGroup,
  deleteGroup,
  type Group,
  listGroups,
  renameGroup,
} from '../api/groups'
import { ApiError, listSystems, type System } from '../api/systems'
import { useEventStream } from '../hooks/useEventStream'
import {
  isGlobalOperator,
  roleOnGroup,
  useScope,
} from '../hooks/useScope'
import FanOutOutcomesPanel from '../components/FanOutOutcomesPanel'
import TargetedPackageModal from '../components/TargetedPackageModal'
import {
  fanOutOnSystem,
  fanOutTargetedSelectionsOnSystem,
  type FanOutOutcome,
  type TargetedSelection,
} from '../util/updaterFanOut'
import { TABLE_DENSITY_STYLE, TIGHT_END, TIGHT_START } from '../components/systemsTableHelpers'

type PageSize = 25 | 50 | 100 | 'all'
const PAGE_SIZE_OPTIONS: { value: PageSize; label: string }[] = [
  { value: 25, label: '25 per page' },
  { value: 50, label: '50 per page' },
  { value: 100, label: '100 per page' },
  { value: 'all', label: 'All' },
]

type SortKey = 'name' | 'systemCount' | 'createdAt'
type SortDir = 'asc' | 'desc'

type Confirm =
  | { kind: 'remove-one'; group: Group }
  | { kind: 'remove-bulk'; ids: string[] }
  | { kind: 'apply-bulk'; groups: Group[] }

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [systems, setSystems] = useState<System[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Group | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  // Updater fan-out state for the per-group Check/Update actions.
  // Same shape as SystemsPage / GroupDetailPage so the same panel
  // can render the results.
  const [updaterOutcomes, setUpdaterOutcomes] = useState<
    FanOutOutcome[] | null
  >(null)
  const [updaterBusy, setUpdaterBusy] = useState<string | null>(null)
  const [targetedGroups, setTargetedGroups] = useState<Group[] | null>(null)
  const [targetedBusy, setTargetedBusy] = useState(false)

  const { state: scopeState } = useScope()
  // canOperateSystem mirrors the SystemsPage gate so the per-group
  // fan-out skips systems the caller can't operate on. The skipped
  // outcomes still appear in the results panel so it's clear what
  // was attempted vs. what was held back.
  const canOperateSystem = (s: System): boolean => {
    if (isGlobalOperator(scopeState)) return true
    if (!s.groupId) return false
    const r = roleOnGroup(scopeState, s.groupId)
    return r === 'admin' || r === 'operator'
  }

  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    systemCount: '',
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
      const [groupData, systemData] = await Promise.all([
        listGroups(),
        listSystems(),
      ])
      setGroups(groupData)
      setSystems(systemData)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // membersOf returns every system whose groupId matches one of
  // the provided group ids. Used to expand a group-level
  // Check/Update into the underlying system fan-out.
  const membersOf = useCallback(
    (groupIds: string[]): System[] => {
      const set = new Set(groupIds)
      return systems.filter((s) => s.groupId !== undefined && s.groupId !== null && set.has(s.groupId))
    },
    [systems],
  )

  // runningByGroup counts the member systems flagged `running` by
  // the backend (driven by updater_run_locks via SSE since 2026-05-21).
  // The map drives the inline spinner next to each group name so an
  // operator can tell at a glance which groups currently have work
  // in flight — including work kicked off in another tab.
  const runningByGroup = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of systems) {
      if (s.groupId && s.running) {
        m.set(s.groupId, (m.get(s.groupId) ?? 0) + 1)
      }
    }
    return m
  }, [systems])

  // partitionTargets splits a candidate list into the systems the
  // caller can act on now and a per-skip-reason outcome list that
  // matches the FanOutOutcomesPanel shape. Mirrors the unreachable +
  // RBAC skip pattern used on SystemsPage / GroupDetailPage so the
  // operator sees one banner with every per-system disposition.
  const partitionTargets = (
    targets: System[],
    action: 'check' | 'apply',
  ): { operable: System[]; skipped: FanOutOutcome[] } => {
    const operable: System[] = []
    const skipped: FanOutOutcome[] = []
    for (const s of targets) {
      if (!canOperateSystem(s)) {
        skipped.push({
          systemId: s.id,
          systemName: s.name,
          action,
          attempted: 0,
          skipped: true,
          skipReason: 'No operator permission on this system.',
          results: [],
        })
        continue
      }
      if (s.status === 'unreachable') {
        skipped.push({
          systemId: s.id,
          systemName: s.name,
          action,
          attempted: 0,
          skipped: true,
          skipReason: 'System is marked unreachable.',
          results: [],
        })
        continue
      }
      operable.push(s)
    }
    return { operable, skipped }
  }

  // runSystemBulk handles the Retry path from the results panel —
  // by then the operator is targeting specific system ids, not
  // group ids, so it's a regular system fan-out matching SystemsPage.
  const runSystemBulk = async (
    action: 'check' | 'apply',
    targets: System[],
  ) => {
    if (targets.length === 0) return
    setUpdaterOutcomes(null)
    setUpdaterBusy(`system-bulk:${action}`)
    const { operable, skipped } = partitionTargets(targets, action)
    const outcomes = await Promise.all(
      operable.map((s) => fanOutOnSystem(s.id, s.name, action)),
    )
    setUpdaterOutcomes([...outcomes, ...skipped])
    setUpdaterBusy(null)
    await refresh()
  }

  const runGroupBulk = async (
    action: 'check' | 'apply',
    targetGroups: Group[],
  ) => {
    const ids = targetGroups.map((g) => g.id)
    const targets = membersOf(ids)
    if (targets.length === 0) {
      setUpdaterOutcomes([
        {
          systemId: 'no-members',
          systemName: targetGroups.map((g) => g.name).join(', ') || 'group',
          action,
          attempted: 0,
          skipped: true,
          skipReason:
            'No systems in the selected group(s). Add systems before running an updater.',
          results: [],
        },
      ])
      return
    }
    setUpdaterOutcomes(null)
    setUpdaterBusy(`group-bulk:${action}`)
    const { operable, skipped } = partitionTargets(targets, action)
    const outcomes = await Promise.all(
      operable.map((s) => fanOutOnSystem(s.id, s.name, action)),
    )
    setUpdaterOutcomes([...outcomes, ...skipped])
    setUpdaterBusy(null)
    await refresh()
  }

  // runGroupBulkTargeted expands the chosen groups into their
  // members and fans out a per-(updater, package) targeted apply
  // across the whole union. Same shape as runGroupBulk: systems the
  // caller can't operate or that are marked unreachable land as
  // skipped rows in the outcomes panel.
  const runGroupBulkTargeted = async (
    targetGroups: Group[],
    selections: TargetedSelection[],
  ) => {
    const ids = targetGroups.map((g) => g.id)
    const targets = membersOf(ids)
    if (targets.length === 0 || selections.length === 0) {
      setUpdaterOutcomes([
        {
          systemId: 'no-members',
          systemName: targetGroups.map((g) => g.name).join(', ') || 'group',
          action: 'apply',
          attempted: 0,
          skipped: true,
          skipReason:
            'No systems in the selected group(s). Add systems before running an updater.',
          results: [],
        },
      ])
      return
    }
    setUpdaterOutcomes(null)
    setUpdaterBusy('group-bulk:targeted')
    const { operable, skipped } = partitionTargets(targets, 'apply')
    const outcomes = await Promise.all(
      operable.map((s) =>
        fanOutTargetedSelectionsOnSystem(s.id, s.name, selections),
      ),
    )
    setUpdaterOutcomes([...outcomes, ...skipped])
    setUpdaterBusy(null)
    await refresh()
  }

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
    if (!groups) return []
    const n = filters.name.trim().toLowerCase()
    const c = filters.systemCount.trim().toLowerCase()
    const created = filters.createdAt.trim().toLowerCase()
    return groups.filter((row) => {
      if (n && !row.name.toLowerCase().includes(n)) return false
      if (c && !String(row.systemCount).includes(c)) return false
      if (created) {
        if (
          !new Date(row.createdAt).toLocaleString().toLowerCase().includes(created)
        )
          return false
      }
      return true
    })
  }, [groups, filters])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortKey === 'name') {
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
      } else if (sortKey === 'systemCount') {
        av = a.systemCount
        bv = b.systemCount
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
    if (!groups) return
    const valid = new Set(groups.map((g) => g.id))
    setSelected((prev) => {
      const next = new Set<string>()
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id)
      })
      return next.size === prev.size ? prev : next
    })
  }, [groups])

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
    visible.length > 0 && visible.every((g) => selected.has(g.id))

  const toggleAllVisible = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      visible.forEach((g) => {
        if (checked) next.add(g.id)
        else next.delete(g.id)
      })
      return next
    })
  }

  const removeOne = async (id: string) => {
    setActionError(null)
    try {
      await deleteGroup(id)
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
              <Title headingLevel="h1">System Groups</Title>
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
                  if (value === 'check-bulk' || value === 'apply-bulk') {
                    const ids = selected
                    const targetGroups =
                      groups?.filter((g) => ids.has(g.id)) ?? []
                    if (targetGroups.length === 0) return
                    if (value === 'check-bulk') {
                      void runGroupBulk('check', targetGroups)
                    } else {
                      setConfirm({ kind: 'apply-bulk', groups: targetGroups })
                    }
                  }
                  if (value === 'update-package') {
                    const ids = selected
                    const targetGroups =
                      groups?.filter((g) => ids.has(g.id)) ?? []
                    if (targetGroups.length === 0) return
                    setTargetedGroups(targetGroups)
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
                    Add system group
                  </DropdownItem>
                  <DropdownItem
                    value="check-bulk"
                    key="check-bulk"
                    isDisabled={selectionCount === 0 || updaterBusy !== null}
                  >
                    Check selected groups
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                  <DropdownItem
                    value="apply-bulk"
                    key="apply-bulk"
                    isDisabled={selectionCount === 0 || updaterBusy !== null}
                  >
                    Update selected groups
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                  <DropdownItem
                    value="update-package"
                    key="update-package"
                    isDisabled={selectionCount === 0 || updaterBusy !== null}
                  >
                    Update package…
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
          <Alert variant="danger" title="Could not load system groups" isInline>
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
        {updaterOutcomes && (
          <FanOutOutcomesPanel
            outcomes={updaterOutcomes}
            onDismiss={() => setUpdaterOutcomes(null)}
            onRetry={(ids, action) => {
              const targets = systems.filter((s) => ids.includes(s.id))
              void runSystemBulk(action, targets)
            }}
            busy={updaterBusy !== null}
          />
        )}
        {!loadError && groups === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {groups !== null && groups.length === 0 && (
          <EmptyState titleText="No system groups yet" headingLevel="h2">
            <EmptyStateBody>
              Create your first system group from the Actions menu in the toolbar above.
            </EmptyStateBody>
          </EmptyState>
        )}
        {groups !== null && groups.length > 0 && (
          <Table
            aria-label="System groups"
            variant="compact"
            style={TABLE_DENSITY_STYLE}
          >
            <Thead>
              <Tr>
                <Th
                  aria-label="Select all"
                  select={{
                    onSelect: () => toggleAllVisible(!allVisibleSelected),
                    isSelected: allVisibleSelected,
                    isDisabled: visible.length === 0,
                  }}
                  style={TIGHT_END}
                />
                <Th
                  sort={sortFor('name', 1)}
                  style={{ width: '55%' }}
                >
                  Name
                </Th>
                <Th
                  sort={sortFor('systemCount', 2)}
                  style={{ width: '15%' }}
                >
                  Systems
                </Th>
                <Th
                  sort={sortFor('createdAt', 3)}
                  style={{ width: '30%' }}
                >
                  Created
                </Th>
                <Th screenReaderText="Actions" style={TIGHT_START} />
              </Tr>
              <Tr>
                <Th screenReaderText="Filter spacer" style={TIGHT_END} />
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
                    aria-label="Filter system count"
                    placeholder="Filter count"
                    value={filters.systemCount}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, systemCount: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, systemCount: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter created"
                    placeholder="Filter created"
                    value={filters.createdAt}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, createdAt: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, createdAt: '' }))}
                  />
                </Th>
                <Th screenReaderText="Actions spacer" style={TIGHT_START} />
              </Tr>
            </Thead>
            <Tbody>
              {visible.map((g, rowIndex) => (
                <Tr key={g.id}>
                  <Td
                    select={{
                      rowIndex,
                      onSelect: (_, isSelecting) => toggleRow(g.id, isSelecting),
                      isSelected: selected.has(g.id),
                    }}
                    style={TIGHT_END}
                  />
                  <Td dataLabel="Name" modifier="truncate">
                    <Link to={`/groups/${encodeURIComponent(g.id)}`}>
                      {g.name}
                    </Link>
                    {(() => {
                      const c = runningByGroup.get(g.id) ?? 0
                      if (c === 0) return null
                      const label = `${c} ${c === 1 ? 'system' : 'systems'} in this group running an updater`
                      return (
                        <>
                          {' '}
                          <span title={label}>
                            <Spinner size="sm" aria-label={label} />
                          </span>
                        </>
                      )
                    })()}
                  </Td>
                  <Td dataLabel="Systems">{g.systemCount}</Td>
                  <Td dataLabel="Created">
                    {new Date(g.createdAt).toLocaleString()}
                  </Td>
                  <Td dataLabel="Actions" isActionCell style={TIGHT_START}>
                    <ActionsColumn
                      items={[
                        {
                          title:
                            updaterBusy === `group:check:${g.id}`
                              ? 'Checking…'
                              : 'Check',
                          isDisabled: updaterBusy !== null,
                          onClick: () => {
                            setUpdaterBusy(`group:check:${g.id}`)
                            void runGroupBulk('check', [g]).finally(() =>
                              setUpdaterBusy(null),
                            )
                          },
                        },
                        {
                          title:
                            updaterBusy === `group:apply:${g.id}`
                              ? 'Updating…'
                              : 'Update',
                          isDisabled: updaterBusy !== null,
                          onClick: () =>
                            setConfirm({ kind: 'apply-bulk', groups: [g] }),
                        },
                        {
                          title: 'Update package…',
                          isDisabled: updaterBusy !== null,
                          onClick: () => setTargetedGroups([g]),
                        },
                        {
                          title: `Rename ${g.name}`,
                          onClick: () => setRenameTarget(g),
                        },
                        {
                          title: `Remove ${g.name}`,
                          onClick: () =>
                            setConfirm({ kind: 'remove-one', group: g }),
                        },
                      ]}
                    />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>

      {groups !== null && groups.length > 0 && pageSize !== 'all' && (
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

      <AddGroupModal
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false)
          await refresh()
        }}
      />

      <RenameGroupModal
        target={renameTarget}
        onCancel={() => setRenameTarget(null)}
        onRenamed={async () => {
          setRenameTarget(null)
          await refresh()
        }}
      />

      <ConfirmRemoveModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          if (confirm.kind === 'remove-one') {
            await removeOne(confirm.group.id)
          } else if (confirm.kind === 'remove-bulk') {
            for (const id of confirm.ids) {
              await removeOne(id)
            }
            setSelected(new Set())
          }
          setConfirm(null)
          await refresh()
        }}
      />
      <ConfirmApplyBulkModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm?.kind !== 'apply-bulk') return
          const targets = confirm.groups
          setConfirm(null)
          await runGroupBulk('apply', targets)
        }}
      />
      <TargetedPackageModal
        isOpen={targetedGroups !== null}
        onClose={() => {
          if (!targetedBusy) setTargetedGroups(null)
        }}
        systems={
          targetedGroups
            ? membersOf(targetedGroups.map((g) => g.id))
            : []
        }
        busy={targetedBusy}
        onSubmit={async (selections) => {
          if (!targetedGroups) return
          setTargetedBusy(true)
          try {
            await runGroupBulkTargeted(targetedGroups, selections)
          } finally {
            setTargetedBusy(false)
            setTargetedGroups(null)
          }
        }}
      />
    </>
  )
}

type AddGroupModalProps = {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function AddGroupModal({ isOpen, onClose, onCreated }: AddGroupModalProps) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setName('')
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [isOpen])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createGroup({ name })
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
      aria-labelledby="add-group-title"
    >
      <ModalHeader title="Add system group" labelId="add-group-title" />
      <ModalBody>
        <Form id="add-group-form" onSubmit={onSubmit}>
          <FormGroup label="Name" fieldId="add-group-name" isRequired>
            <TextInput
              id="add-group-name"
              value={name}
              onChange={(_, v) => setName(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
              placeholder="e.g. Production"
            />
          </FormGroup>
          {submitError && (
            <Alert variant="danger" title="Could not add system group" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="add-group-form"
          variant="primary"
          isLoading={submitting}
          isDisabled={submitting || !name.trim()}
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

type RenameGroupModalProps = {
  target: Group | null
  onCancel: () => void
  onRenamed: () => void | Promise<void>
}

function RenameGroupModal({ target, onCancel, onRenamed }: RenameGroupModalProps) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setName(target.name)
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [target])

  const isOpen = target !== null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await renameGroup(target.id, { name })
      await onRenamed()
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
      onClose={onCancel}
      aria-labelledby="rename-group-title"
    >
      <ModalHeader title="Rename system group" labelId="rename-group-title" />
      <ModalBody>
        <Form id="rename-group-form" onSubmit={onSubmit}>
          <FormGroup label="Name" fieldId="rename-group-name" isRequired>
            <TextInput
              id="rename-group-name"
              value={name}
              onChange={(_, v) => setName(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
            />
          </FormGroup>
          {submitError && (
            <Alert variant="danger" title="Could not rename system group" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="rename-group-form"
          variant="primary"
          isLoading={submitting}
          isDisabled={submitting || !name.trim() || name === target?.name}
        >
          Save
        </Button>
        <Button variant="link" onClick={onCancel} isDisabled={submitting}>
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
  // Only the remove-* kinds use this modal. apply-bulk has its own
  // confirmation surface so the wording can lean "update", not
  // "remove".
  const isOpen =
    confirm?.kind === 'remove-one' || confirm?.kind === 'remove-bulk'
  const isBulk = confirm?.kind === 'remove-bulk'
  const title = isBulk ? 'Remove system groups?' : 'Remove system group?'
  const body = isBulk
    ? `Permanently remove ${confirm && confirm.kind === 'remove-bulk' ? confirm.ids.length : 0} system groups? Member systems are not deleted; they will become ungrouped.`
    : `Permanently remove ${confirm?.kind === 'remove-one' ? confirm.group.name : ''}? Member systems are not deleted; they will become ungrouped.`
  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onCancel}
      aria-labelledby="remove-group-title"
    >
      <ModalHeader title={title} labelId="remove-group-title" />
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

function ConfirmApplyBulkModal({
  confirm,
  onCancel,
  onConfirm,
}: ConfirmRemoveModalProps) {
  const isOpen = confirm?.kind === 'apply-bulk'
  const count = confirm?.kind === 'apply-bulk' ? confirm.groups.length : 0
  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onCancel}
      aria-labelledby="apply-group-bulk-title"
    >
      <ModalHeader
        title={`Update systems in ${count} group${count === 1 ? '' : 's'}?`}
        labelId="apply-group-bulk-title"
      />
      <ModalBody>
        Apply pending updates on every system in the selected group
        {count === 1 ? '' : 's'}. Each system runs every updater that is
        detected and enabled on it. The result panel reports per-system
        outcomes when the run completes.
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={() => void onConfirm()}>
          Update
        </Button>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
