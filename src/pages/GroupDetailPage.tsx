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
import { Link, useParams, useSearchParams } from 'react-router-dom'
import GroupRolesTab from '../components/GroupRolesTab'
import GroupExclusionsTab from '../components/GroupExclusionsTab'
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
import { useLabelStyles } from '../hooks/useLabelStyles'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { interpretLabelInput } from '../lib/labelSelectorPartition'
import FanOutOutcomesPanel from '../components/FanOutOutcomesPanel'
import SystemLabelsCell from '../components/SystemLabelsCell'
import {
  PendingUpdatesCell,
  PlatformIcon,
  SystemStatusIcon,
} from '../components/systemsTable'
import {
  TABLE_DENSITY_STYLE,
  TIGHT_END,
  TIGHT_START,
  formatLastChecked,
  formatPendingUpdates,
} from '../components/systemsTableHelpers'
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
  const [targetedOpen, setTargetedOpen] = useState(false)
  const [targetedBusy, setTargetedBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'members' | 'roles' | 'credentials' | 'exclusions'
  >('members')

  const hostnameVisible = useMediaQuery('(min-width: 90.625rem)')
  const colWidths = hostnameVisible
    ? {
        name: '26%',
        hostname: '26%',
        status: '12%',
        lastChecked: '20%',
        updates: '16%',
      }
    : {
        name: '50%',
        hostname: '25%',
        status: '12%',
        lastChecked: '26%',
        updates: '12%',
      }

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

  const [searchParams, setSearchParams] = useSearchParams()
  // labelSelector mirrors SystemsPage: the committed `?labels=` URL
  // value drives the per-page systems fetch, while selectorInput is
  // the live (un-debounced) text in the column-level filter input
  // — see SystemsPage.tsx for the full commentary.
  const labelSelector = searchParams.get('labels') ?? ''
  const [selectorInput, setSelectorInput] = useState(labelSelector)
  const { styles: labelStyles } = useLabelStyles()
  const [filters, setFilters] = useState<Record<string, string>>({
    name: '',
    hostname: '',
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
  // busyCount counts every member system known to have work in flight,
  // whether kicked off in this tab (rowBusy) or surfaced by the
  // backend's running flag from another tab / session.
  const busyCount =
    (systems ?? []).reduce(
      (n, s) => n + (rowBusy.has(s.id) || s.running ? 1 : 0),
      0,
    )

  const selectorRef = useRef(labelSelector)
  selectorRef.current = labelSelector

  const refresh = useCallback(async () => {
    try {
      const { backend } = interpretLabelInput(selectorRef.current)
      const data = await listSystems(backend ? { labels: backend } : undefined)
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
    markBusy(s.id, action)
    try {
      const outcome = await fanOutOnSystem(s.id, s.name, action)
      setUpdaterOutcomes([outcome])
    } finally {
      clearBusy(s.id)
    }
    await refresh()
  }

  const runBulk = async (
    action: 'check' | 'apply',
    targets: System[],
  ) => {
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

  // runBulkTargeted mirrors SystemsPage's flow for group members.
  // The picker modal supplies the chosen (updater, package) list;
  // per-system overlap filtering happens inside the helper.
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
  }, [labelSelector, refresh])

  // Debounced commit of selectorInput → URL. The labelSelector watcher
  // above then triggers a single listSystems call.
  const selectorCommitRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  useEffect(() => {
    if (selectorCommitRef.current) clearTimeout(selectorCommitRef.current)
    const next = selectorInput.trim()
    const current = searchParams.get('labels') ?? ''
    if (next === current) return
    selectorCommitRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams)
      if (next === '') params.delete('labels')
      else params.set('labels', next)
      setSearchParams(params, { replace: true })
    }, 300)
    return () => {
      if (selectorCommitRef.current) clearTimeout(selectorCommitRef.current)
    }
  }, [selectorInput, searchParams, setSearchParams])

  const onLabelClick = useCallback(
    (l: { key: string; value: string | null }) => {
      const token = l.value === null ? l.key : `${l.key}=${l.value}`
      setSelectorInput((current) => {
        const tokens = current
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
        if (tokens.includes(token)) return current
        return tokens.length ? `${tokens.join(',')},${token}` : token
      })
    },
    [],
  )

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
    const lc = filters.lastChecked.trim().toLowerCase()
    const pu = filters.pendingUpdates.trim().toLowerCase()
    const { matches: labelMatches } = interpretLabelInput(labelSelector)
    return members.filter((row) => {
      if (!labelMatches(row)) return false
      if (n && !row.name.toLowerCase().includes(n)) return false
      if (h && !row.hostname.toLowerCase().includes(h)) return false
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
  }, [members, filters, labelSelector])

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
          onSelect={(_, key) =>
            setActiveTab(
              key as 'members' | 'roles' | 'credentials' | 'exclusions',
            )
          }
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
          <Tab
            eventKey="exclusions"
            title={<TabTitleText>Exclusions</TabTitleText>}
          />
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
      {activeTab === 'exclusions' && (
        <PageSection>
          <GroupExclusionsTab
            groupId={group.id}
            canManage={canAdminThisGroup}
          />
        </PageSection>
      )}
      {activeTab === 'members' && (<>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
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
                    Add systems
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
            busy={busyCount > 0}
          />
        )}
        {!loadError && systems === null && labelSelector === '' && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {!loadError &&
          systems !== null &&
          members.length === 0 &&
          labelSelector === '' && (
            <EmptyState titleText="No systems in this group" headingLevel="h2">
              <EmptyStateBody>
                Add systems from the Actions menu in the toolbar above.
              </EmptyStateBody>
            </EmptyState>
          )}
        {(loadError != null ||
          labelSelector !== '' ||
          (systems !== null && members.length > 0)) && (
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
                <Th sort={sortFor('name', 1)} style={{ width: colWidths.name }}>
                  Name
                </Th>
                <Th
                  sort={sortFor('hostname', 2)}
                  visibility={['hidden', 'visibleOn2Xl']}
                  style={{ width: colWidths.hostname }}
                >
                  Hostname
                </Th>
                <Th sort={sortFor('status', 3)} style={{ width: colWidths.status }}>
                  Labels
                </Th>
                <Th
                  sort={sortFor('lastChecked', 4)}
                  style={{ width: colWidths.lastChecked }}
                >
                  Last checked
                </Th>
                <Th
                  sort={sortFor('pendingUpdates', 5)}
                  style={{ width: colWidths.updates }}
                >
                  Updates
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
                <Th visibility={['hidden', 'visibleOn2Xl']}>
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
                    aria-label="Label selector"
                    placeholder="env=prod,!owner"
                    value={selectorInput}
                    onChange={(_, v) => setSelectorInput(v)}
                    onClear={() => setSelectorInput('')}
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
                    aria-label="Filter updates"
                    placeholder="Filter updates"
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
              {visible.length === 0 && (
                <Tr>
                  <Td colSpan={hostnameVisible ? 7 : 6}>
                    No systems match this filter.
                  </Td>
                </Tr>
              )}
              {visible.map((s, rowIndex) => {
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
                        <PlatformIcon
                          osFamily={s.osFamily}
                          osDistribution={s.osDistribution}
                          isWindows={s.isWindows}
                        />
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
                    <Td
                      dataLabel="Hostname"
                      modifier="truncate"
                      visibility={['hidden', 'visibleOn2Xl']}
                    >
                      {s.hostname}
                    </Td>
                    <Td dataLabel="Labels">
                      <SystemLabelsCell
                        status={s.status}
                        labels={s.labels}
                        styleOverrides={labelStyles}
                        onLabelClick={onLabelClick}
                      />
                    </Td>
                    <Td dataLabel="Last checked">
                      {formatLastChecked(s.lastCheckedAt)}
                    </Td>
                    <Td dataLabel="Updates">
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
      <TargetedPackageModal
        isOpen={targetedOpen}
        onClose={() => {
          if (!targetedBusy) setTargetedOpen(false)
        }}
        systems={members.filter((s) => selected.has(s.id))}
        busy={targetedBusy}
        onSubmit={async (selections) => {
          const targets = members.filter((s) => selected.has(s.id))
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
