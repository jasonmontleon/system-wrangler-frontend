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
import { Link } from 'react-router-dom'
import {
  ApiError,
  createSystem,
  deleteSystem,
  listSystems,
  type System,
} from '../api/systems'
import {
  PendingUpdatesCell,
  SystemStatusIcon,
} from '../components/systemsTable'
import {
  STATUS_LABELS,
  TABLE_DENSITY_STYLE,
  TIGHT_END,
  TIGHT_START,
  formatLastChecked,
  formatPendingUpdates,
} from '../components/systemsTableHelpers'
import { listGroups, type Group } from '../api/groups'
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
  | 'lastChecked'
  | 'pendingUpdates'
type SortDir = 'asc' | 'desc'

type Confirm =
  | { kind: 'remove-one'; system: System }
  | { kind: 'remove-bulk'; ids: string[] }
  | { kind: 'apply-bulk'; systems: System[] }

export default function SystemsPage() {
  const [systems, setSystems] = useState<System[] | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [targetedOpen, setTargetedOpen] = useState(false)
  const [targetedBusy, setTargetedBusy] = useState(false)

  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    hostname: '',
    status: '',
    group: '',
    lastChecked: '',
    pendingUpdates: '',
  })
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [page, setPage] = useState(1)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Scope drives the per-row gating on operate actions; credential
  // management has moved to SystemDetailPage so it isn't relevant
  // here any more.
  const { state: scopeState } = useScope()
  // canOperateSystem mirrors the backend's CanOperateSystem gate:
  // Global Operator+ on any system, Group Admin/Operator on this
  // system's group. Ungrouped systems are only operable by global
  // roles.
  const canOperateSystem = (s: System): boolean => {
    if (isGlobalOperator(scopeState)) return true
    if (!s.groupId) return false
    const r = roleOnGroup(scopeState, s.groupId)
    return r === 'admin' || r === 'operator'
  }

  // Updater fan-out state: when an action runs we record the
  // outcomes so the page can show a banner. Phase 5 will replace
  // this with a richer toast / drawer; for now a stacked alert is
  // enough to know what happened.
  const [updaterOutcomes, setUpdaterOutcomes] = useState<FanOutOutcome[] | null>(null)
  // rowBusy holds the per-system in-flight tasks this tab has
  // initiated. The map's presence drives the row spinner and the
  // toolbar pill; the value tells the kebab whether to label
  // itself "Checking…" or "Updating…". Scope is intentionally
  // local-only — concurrent activity from other operators is not
  // visible here. See the roadmap entry on SSE-backed progress.
  const [rowBusy, setRowBusy] = useState<Map<string, 'check' | 'apply'>>(
    () => new Map(),
  )

  const markBusy = (id: string, kind: 'check' | 'apply') => {
    setRowBusy((prev) => {
      const next = new Map(prev)
      next.set(id, kind)
      return next
    })
  }
  const clearBusy = (id: string) => {
    setRowBusy((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  const runOnRow = async (s: System, action: 'check' | 'apply') => {
    setUpdaterOutcomes(null)
    markBusy(s.id, action)
    try {
      const outcome = await fanOutOnSystem(s.id, s.name, action)
      setUpdaterOutcomes([outcome])
    } finally {
      clearBusy(s.id)
    }
    await refresh()
  }

  // runBulk fans out an action across every currently-selected
  // system. Per-system advisory locks on the backend already
  // serialize concurrent runs against the same host, so the
  // outer Promise.all runs all selected hosts in parallel. Systems
  // the caller cannot operate are not POSTed against; they show up
  // as `skipped` outcomes so the banner still accounts for them.
  const runBulk = async (action: 'check' | 'apply', targets: System[]) => {
    if (targets.length === 0) return
    setUpdaterOutcomes(null)
    const skipped: FanOutOutcome[] = []
    const operable: System[] = []
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
    operable.forEach((s) => markBusy(s.id, action))
    const outcomes = await Promise.all(
      operable.map(async (s) => {
        try {
          return await fanOutOnSystem(s.id, s.name, action)
        } finally {
          clearBusy(s.id)
        }
      }),
    )
    setUpdaterOutcomes([...outcomes, ...skipped])
    await refresh()
  }

  // runBulkTargeted fans out a per-(updater, package) targeted apply
  // across the selected systems. Each system is fetched for its
  // current per-updater pending list inside the helper; only systems
  // whose pendingPackages still include the chosen pair get applied,
  // the rest land in the outcomes panel as skipped.
  const runBulkTargeted = async (
    targets: System[],
    selections: TargetedSelection[],
  ) => {
    if (targets.length === 0 || selections.length === 0) return
    setUpdaterOutcomes(null)
    const skipped: FanOutOutcome[] = []
    const operable: System[] = []
    for (const s of targets) {
      if (!canOperateSystem(s)) {
        skipped.push({
          systemId: s.id,
          systemName: s.name,
          action: 'apply',
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
          action: 'apply',
          attempted: 0,
          skipped: true,
          skipReason: 'System is marked unreachable.',
          results: [],
        })
        continue
      }
      operable.push(s)
    }
    operable.forEach((s) => markBusy(s.id, 'apply'))
    const outcomes = await Promise.all(
      operable.map(async (s) => {
        try {
          return await fanOutTargetedSelectionsOnSystem(s.id, s.name, selections)
        } finally {
          clearBusy(s.id)
        }
      }),
    )
    setUpdaterOutcomes([...outcomes, ...skipped])
    await refresh()
  }

  // busyCount counts every system known to have work in flight,
  // whether kicked off in this tab (rowBusy) or surfaced by the
  // backend's running flag from another tab / session.
  const busyCount =
    (systems ?? []).reduce(
      (n, s) => n + (rowBusy.has(s.id) || s.running ? 1 : 0),
      0,
    )

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
    const lc = filters.lastChecked.trim().toLowerCase()
    const pu = filters.pendingUpdates.trim().toLowerCase()
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
      if (lc) {
        if (!formatLastChecked(row.lastCheckedAt).toLowerCase().includes(lc)) return false
      }
      if (pu) {
        if (!formatPendingUpdates(row.pendingUpdates).toLowerCase().includes(pu))
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
      } else if (sortKey === 'lastChecked') {
        // Never-checked rows sort as 0 (oldest) so the operator
        // sees "stale or untouched first" when sorting ascending.
        av = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0
        bv = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0
      } else {
        // pendingUpdates: undefined sorts as -1 so "never checked"
        // rows are distinct from "0 pending" — sorting ascending
        // puts unknown state at the top, where the operator can
        // act on it.
        av = a.pendingUpdates ?? -1
        bv = b.pendingUpdates ?? -1
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
            {busyCount > 0 && (
              <ToolbarItem>
                <Label
                  color="blue"
                  icon={<Spinner size="sm" aria-hidden />}
                  aria-label="In-flight tasks"
                >
                  {busyCount} {busyCount === 1 ? 'task' : 'tasks'} running
                </Label>
              </ToolbarItem>
            )}
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
                    const targets =
                      systems?.filter((s) => ids.has(s.id)) ?? []
                    if (targets.length === 0) return
                    if (value === 'check-bulk') {
                      void runBulk('check', targets)
                    } else {
                      // Apply confirmation: this mutates fleet
                      // state, so make the operator acknowledge
                      // the count before firing. Check is
                      // read-only and runs immediately.
                      setConfirm({ kind: 'apply-bulk', systems: targets })
                    }
                  }
                  if (value === 'update-package') {
                    setTargetedOpen(true)
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
                    value="check-bulk"
                    key="check-bulk"
                    isDisabled={selectionCount === 0 || busyCount > 0}
                  >
                    Check selected
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                  <DropdownItem
                    value="apply-bulk"
                    key="apply-bulk"
                    isDisabled={selectionCount === 0 || busyCount > 0}
                  >
                    Update selected
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                  <DropdownItem
                    value="update-package"
                    key="update-package"
                    isDisabled={selectionCount === 0 || busyCount > 0}
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
        {updaterOutcomes && (
          <FanOutOutcomesPanel
            outcomes={updaterOutcomes}
            onDismiss={() => setUpdaterOutcomes(null)}
            onRetry={(ids, action) => {
              const targets = systems?.filter((s) => ids.includes(s.id)) ?? []
              void runBulk(action, targets)
            }}
            busy={busyCount > 0}
          />
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
          <Table
            aria-label="Systems"
            variant="compact"
            style={TABLE_DENSITY_STYLE}
          >
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: () => toggleAllVisible(!allVisibleSelected),
                    isSelected: allVisibleSelected,
                    isDisabled: visible.length === 0,
                  }}
                  style={TIGHT_END}
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
                <Th width={20} sort={sortFor('lastChecked', 5)}>
                  Last checked
                </Th>
                <Th width={15} sort={sortFor('pendingUpdates', 6)}>
                  Updates available
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
                    aria-label="Filter last checked"
                    placeholder="Filter last checked"
                    value={filters.lastChecked}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, lastChecked: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, lastChecked: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter updates available"
                    placeholder="Filter updates available"
                    value={filters.pendingUpdates}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, pendingUpdates: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, pendingUpdates: '' }))}
                  />
                </Th>
                <Th screenReaderText="Actions spacer" style={TIGHT_START} />
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
                      style={TIGHT_END}
                    />
                    <Td dataLabel="Name" modifier="truncate">
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                        }}
                      >
                        {rowBusy.has(s.id) || s.running ? (
                          <Spinner
                            size="sm"
                            aria-label={
                              rowBusy.get(s.id) === 'check'
                                ? 'Check in progress'
                                : rowBusy.get(s.id) === 'apply'
                                  ? 'Update in progress'
                                  : 'Run in progress'
                            }
                          />
                        ) : (
                          <SystemStatusIcon
                            status={s.status}
                            pendingUpdates={s.pendingUpdates}
                            lastRunFailed={s.lastRunFailed}
                          />
                        )}
                        <Link to={`/systems/${encodeURIComponent(s.id)}`}>
                          {s.name}
                        </Link>
                      </span>
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
                    <Td dataLabel="Last checked">
                      {formatLastChecked(s.lastCheckedAt)}
                    </Td>
                    <Td dataLabel="Updates available">
                      <PendingUpdatesCell
                        count={s.pendingUpdates}
                        packages={s.pendingPackages}
                      />
                    </Td>
                    <Td dataLabel="Actions" isActionCell style={TIGHT_START}>
                      <ActionsColumn
                        items={[
                          ...(canOperateSystem(s)
                            ? [
                                {
                                  title:
                                    rowBusy.get(s.id) === 'check'
                                      ? 'Checking…'
                                      : 'Check',
                                  isDisabled: rowBusy.has(s.id) || !!s.running,
                                  onClick: () => void runOnRow(s, 'check'),
                                },
                                {
                                  title:
                                    rowBusy.get(s.id) === 'apply'
                                      ? 'Updating…'
                                      : 'Update',
                                  isDisabled: rowBusy.has(s.id) || !!s.running,
                                  onClick: () => void runOnRow(s, 'apply'),
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


      <ConfirmRemoveModal
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          if (confirm.kind === 'remove-one') {
            await removeOne(confirm.system.id)
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
          const targets = confirm.systems
          setConfirm(null)
          await runBulk('apply', targets)
        }}
      />
      <TargetedPackageModal
        isOpen={targetedOpen}
        onClose={() => {
          if (!targetedBusy) setTargetedOpen(false)
        }}
        systems={
          systems?.filter((s) => selected.has(s.id)) ?? []
        }
        busy={targetedBusy}
        onSubmit={async (selections) => {
          const targets =
            systems?.filter((s) => selected.has(s.id)) ?? []
          setTargetedBusy(true)
          try {
            await runBulkTargeted(targets, selections)
          } finally {
            setTargetedBusy(false)
            setTargetedOpen(false)
          }
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
  // Only the remove-* kinds use this modal. The apply-bulk kind has
  // its own confirm component with different wording and a
  // non-destructive button label.
  const isOpen = confirm?.kind === 'remove-one' || confirm?.kind === 'remove-bulk'
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

function ConfirmApplyBulkModal({
  confirm,
  onCancel,
  onConfirm,
}: ConfirmRemoveModalProps) {
  const isOpen = confirm?.kind === 'apply-bulk'
  const count = confirm?.kind === 'apply-bulk' ? confirm.systems.length : 0
  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onCancel}
      aria-labelledby="apply-bulk-title"
    >
      <ModalHeader title={`Update ${count} system${count === 1 ? '' : 's'}?`} labelId="apply-bulk-title" />
      <ModalBody>
        Apply pending updates on the selected systems. Each system runs every
        updater that is detected and enabled on it. The result banner above
        the table reports per-system outcomes when the run completes.
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
