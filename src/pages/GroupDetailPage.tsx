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
  Tab,
  TabTitleText,
  Tabs,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { Link, useParams } from 'react-router-dom'
import GroupRolesTab from '../components/GroupRolesTab'
import {
  canAdminGroup,
  isGlobalAdmin,
  isGlobalOperator,
  roleOnGroup,
  useScope,
} from '../hooks/useScope'
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  listSystems,
  type System,
} from '../api/systems'
import { ApiError } from '../api/systems'
import { getGroup, setSystemGroup, type Group } from '../api/groups'
import {
  deleteGroupSlot,
  getGroupSlot,
  putGroupSlot,
} from '../api/credentials'
import CredentialSlotEditor from '../components/CredentialSlotEditor'
import { useEventStream } from '../hooks/useEventStream'
import FanOutOutcomesPanel from '../components/FanOutOutcomesPanel'
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
import { fanOutOnSystem, type FanOutOutcome } from '../util/updaterFanOut'

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
  | 'lastChecked'
  | 'pendingUpdates'
type SortDir = 'asc' | 'desc'

type Confirm =
  | { kind: 'remove-one'; system: System }
  | { kind: 'remove-bulk'; ids: string[] }
  | { kind: 'apply-bulk'; systems: System[] }

export default function GroupDetailPage() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  const [group, setGroup] = useState<Group | null>(null)
  const [groupError, setGroupError] = useState<{ status: number; message: string } | null>(null)
  const [systems, setSystems] = useState<System[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [activeTab, setActiveTab] = useState<'members' | 'roles' | 'credentials'>(
    'members',
  )

  const { state: scopeState } = useScope()
  const callerRole = roleOnGroup(scopeState, groupId)
  const callerIsGlobalAdmin = isGlobalAdmin(scopeState)
  const canAdminThisGroup = canAdminGroup(scopeState, groupId)
  // Group Admin sees the Roles tab as read-write but the Admin role
  // choice is hidden from their picker — only Global Admin can grant
  // Admin per research/rbac.md.
  const canGrantAdminRole = callerIsGlobalAdmin
  // The tab is visible to every caller that can read the group at all
  // (matching the GET endpoint's gate). Group Operator / Auditor see
  // it read-only.
  const showRolesTab = callerIsGlobalAdmin || callerRole !== ''
  // canOperateSystem mirrors SystemsPage's RBAC gate for the per-
  // row Check/Update items. Global Operator+ may operate anywhere;
  // Group Admin/Operator may operate systems in this specific group.
  const canOperateSystem = (s: System): boolean => {
    if (isGlobalOperator(scopeState)) return true
    if (!s.groupId) return false
    const r = roleOnGroup(scopeState, s.groupId)
    return r === 'admin' || r === 'operator'
  }

  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    hostname: '',
    status: '',
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
  // Updater fan-out state, mirroring SystemsPage. The same
  // FanOutOutcomesPanel renders the results so the operator sees
  // an identical confirmation surface across pages.
  const [updaterOutcomes, setUpdaterOutcomes] = useState<
    FanOutOutcome[] | null
  >(null)
  const [updaterBusy, setUpdaterBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await listSystems()
      setSystems(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // runOnRow fires fanOut against a single system from the row
  // kebab. Mirrors SystemsPage so an operator drilling into a
  // group sees the same outcomes panel they would on the systems
  // list.
  const runOnRow = async (s: System, action: 'check' | 'apply') => {
    setUpdaterOutcomes(null)
    setUpdaterBusy(`${action}:${s.id}`)
    const outcome = await fanOutOnSystem(s.id, s.name, action)
    setUpdaterOutcomes([outcome])
    setUpdaterBusy(null)
    await refresh()
  }

  const runBulk = async (
    action: 'check' | 'apply',
    targets: System[],
  ) => {
    if (targets.length === 0) return
    setUpdaterOutcomes(null)
    setUpdaterBusy(`bulk:${action}`)
    const operable = targets.filter(canOperateSystem)
    const notOperable: FanOutOutcome[] = targets
      .filter((s) => !canOperateSystem(s))
      .map((s) => ({
        systemId: s.id,
        systemName: s.name,
        action,
        attempted: 0,
        skipped: true,
        skipReason: 'No operator permission on this system.',
        results: [],
      }))
    const outcomes = await Promise.all(
      operable.map((s) => fanOutOnSystem(s.id, s.name, action)),
    )
    setUpdaterOutcomes([...outcomes, ...notOperable])
    setUpdaterBusy(null)
    await refresh()
  }

  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    getGroup(groupId)
      .then((g) => {
        if (!cancelled) {
          setGroup(g)
          setGroupError(null)
        }
      })
      .catch((err) => {
        if (cancelled) return
        const status = err instanceof ApiError ? err.status : 500
        const message = err instanceof Error ? err.message : String(err)
        setGroupError({ status, message })
      })
    return () => {
      cancelled = true
    }
  }, [groupId])

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
    () => (systems ?? []).filter((s) => s.groupId === groupId),
    [systems, groupId],
  )

  const filtered = useMemo(() => {
    const n = filters.name.trim().toLowerCase()
    const h = filters.hostname.trim().toLowerCase()
    const st = filters.status.trim().toLowerCase()
    const lc = filters.lastChecked.trim().toLowerCase()
    const pu = filters.pendingUpdates.trim().toLowerCase()
    return members.filter((row) => {
      if (n && !row.name.toLowerCase().includes(n)) return false
      if (h && !row.hostname.toLowerCase().includes(h)) return false
      if (st) {
        const label = STATUS_LABELS[row.status]?.text.toLowerCase() ?? row.status
        if (!label.includes(st)) return false
      }
      if (lc) {
        if (!formatLastChecked(row.lastCheckedAt).toLowerCase().includes(lc))
          return false
      }
      if (pu) {
        if (!formatPendingUpdates(row.pendingUpdates).toLowerCase().includes(pu))
          return false
      }
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
      } else if (sortKey === 'lastChecked') {
        av = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0
        bv = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0
      } else {
        // pendingUpdates: undefined sorts as -1 (distinct from 0)
        av = a.pendingUpdates ?? -1
        bv = b.pendingUpdates ?? -1
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

  if (groupError) {
    return (
      <PageSection>
        <Alert
          variant="danger"
          title={groupError.status === 404 ? 'Group not found' : 'Could not load group'}
          isInline
        >
          {groupError.status === 404
            ? 'The group either does not exist or your role does not grant visibility to it.'
            : groupError.message}
        </Alert>
      </PageSection>
    )
  }

  if (!group) {
    return (
      <Bullseye style={{ paddingTop: 64 }}>
        <Spinner />
      </Bullseye>
    )
  }

  return (
    <>
      <PageSection>
        <Breadcrumb>
          <BreadcrumbItem render={({ className }) => (
            <Link to="/groups" className={className}>System Groups</Link>
          )} />
          <BreadcrumbItem isActive>{group.name}</BreadcrumbItem>
        </Breadcrumb>
      </PageSection>

      <PageSection>
        <Title headingLevel="h1">{group.name}</Title>
      </PageSection>
      <PageSection>
        <Tabs
          activeKey={activeTab}
          onSelect={(_, key) => setActiveTab(key as 'members' | 'roles' | 'credentials')}
          aria-label={`${group.name} tabs`}
        >
          <Tab eventKey="members" title={<TabTitleText>Members</TabTitleText>} />
          {showRolesTab && (
            <Tab eventKey="roles" title={<TabTitleText>Roles</TabTitleText>} />
          )}
          {canAdminThisGroup && (
            <Tab
              eventKey="credentials"
              title={<TabTitleText>Credentials</TabTitleText>}
            />
          )}
        </Tabs>
      </PageSection>
      {activeTab === 'roles' && showRolesTab && (
        <PageSection>
          <GroupRolesTab
            groupId={group.id}
            groupName={group.name}
            canAdmin={canAdminThisGroup}
            canGrantAdminRole={canGrantAdminRole}
          />
        </PageSection>
      )}
      {activeTab === 'credentials' && canAdminThisGroup && (
        <PageSection>
          <CredentialSlotEditor
            load={() => getGroupSlot(group.id)}
            save={(input) => putGroupSlot(group.id, input)}
            remove={() => deleteGroupSlot(group.id)}
            scopeLabel={`Group "${group.name}"`}
          />
        </PageSection>
      )}
      {activeTab === 'members' && (<>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
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
                      members.filter((s) => ids.has(s.id))
                    if (targets.length === 0) return
                    if (value === 'check-bulk') {
                      void runBulk('check', targets)
                    } else {
                      // Apply is destructive enough to warrant a
                      // confirm modal — matches SystemsPage's flow.
                      setConfirm({ kind: 'apply-bulk', systems: targets })
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
                    value="check-bulk"
                    key="check-bulk"
                    isDisabled={selectionCount === 0 || updaterBusy !== null}
                  >
                    Check selected
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
                  </DropdownItem>
                  <DropdownItem
                    value="apply-bulk"
                    key="apply-bulk"
                    isDisabled={selectionCount === 0 || updaterBusy !== null}
                  >
                    Update selected
                    {selectionCount > 0 ? ` (${selectionCount})` : ''}
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
        {updaterOutcomes && (
          <FanOutOutcomesPanel
            outcomes={updaterOutcomes}
            onDismiss={() => setUpdaterOutcomes(null)}
            onRetry={(ids, action) => {
              const targets = members.filter((s) => ids.includes(s.id))
              void runBulk(action, targets)
            }}
            busy={updaterBusy !== null}
          />
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
          <Table
            aria-label={`Systems in ${group.name}`}
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
                <Th width={25} sort={sortFor('name', 1)}>
                  Name
                </Th>
                <Th width={25} sort={sortFor('hostname', 2)}>
                  Hostname
                </Th>
                <Th width={10} sort={sortFor('status', 3)}>
                  Status
                </Th>
                <Th width={25} sort={sortFor('lastChecked', 4)}>
                  Last checked
                </Th>
                <Th width={15} sort={sortFor('pendingUpdates', 5)}>
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
                    aria-label="Filter last checked"
                    placeholder="Filter last checked"
                    value={filters.lastChecked}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, lastChecked: v }))
                    }
                    onClear={() =>
                      setFilters((f) => ({ ...f, lastChecked: '' }))
                    }
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
                    onClear={() =>
                      setFilters((f) => ({ ...f, pendingUpdates: '' }))
                    }
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
                        <SystemStatusIcon
                          status={s.status}
                          pendingUpdates={s.pendingUpdates}
                          lastRunFailed={s.lastRunFailed}
                        />
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
                                    updaterBusy === `check:${s.id}`
                                      ? 'Checking…'
                                      : 'Check',
                                  isDisabled: updaterBusy !== null,
                                  onClick: () => void runOnRow(s, 'check'),
                                },
                                {
                                  title:
                                    updaterBusy === `apply:${s.id}`
                                      ? 'Updating…'
                                      : 'Update',
                                  isDisabled: updaterBusy !== null,
                                  onClick: () => void runOnRow(s, 'apply'),
                                },
                              ]
                            : []),
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
      </>)}

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
          } else if (confirm.kind === 'remove-bulk') {
            for (const id of confirm.ids) {
              await removeFromGroup(id)
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
  // Only the remove-* kinds use this modal. apply-bulk has its own
  // confirmation surface below.
  const isOpen =
    confirm?.kind === 'remove-one' || confirm?.kind === 'remove-bulk'
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
      aria-labelledby="apply-bulk-group-title"
    >
      <ModalHeader
        title={`Update ${count} system${count === 1 ? '' : 's'}?`}
        labelId="apply-bulk-group-title"
      />
      <ModalBody>
        Apply pending updates on the selected systems. Each system runs every
        updater that is detected and enabled on it. The result panel reports
        per-system outcomes when the run completes.
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
