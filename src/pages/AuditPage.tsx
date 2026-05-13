// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateBody,
  Label,
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
  MenuToggle,
  type MenuToggleElement,
} from '@patternfly/react-core'
import {
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table'
import {
  type AuditCursor,
  type AuditOutcome,
  type AuditRecord,
  listAudit,
} from '../api/audit'

type PageSize = 25 | 50 | 100 | 'all'
const PAGE_SIZE_OPTIONS: { value: PageSize; label: string }[] = [
  { value: 25, label: '25 per page' },
  { value: 50, label: '50 per page' },
  { value: 100, label: '100 per page' },
  { value: 'all', label: 'All' },
]

const OUTCOME_LABELS: Record<AuditOutcome, { color: 'green' | 'red' | 'orange'; text: string }> = {
  success: { color: 'green', text: 'Success' },
  failure: { color: 'red', text: 'Failure' },
  denied: { color: 'orange', text: 'Denied' },
}

type SortKey = 'occurredAt' | 'actor' | 'action' | 'target' | 'outcome' | 'requestId'
type SortDir = 'asc' | 'desc'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function formatActor(r: AuditRecord): string {
  if (r.actorKind === 'unauthenticated') return '(unauthenticated)'
  if (r.actorKind === 'system') return '(system)'
  return r.actorLabel || r.actorId || '(user)'
}

function formatTarget(r: AuditRecord): string {
  if (!r.targetKind) return '—'
  const label = r.targetLabel || r.targetId || ''
  return label ? `${r.targetKind}: ${label}` : r.targetKind
}

// Backend MaxLimit cap; "All" requests one big page and then walks the
// cursor until exhausted.
const ALL_LIMIT = 500

export default function AuditPage() {
  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [stack, setStack] = useState<(AuditCursor | undefined)[]>([undefined])
  const [records, setRecords] = useState<AuditRecord[] | null>(null)
  const [nextCursor, setNextCursor] = useState<AuditCursor | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [filters, setFilters] = useState<Record<string, string>>({
    occurredAt: '',
    actor: '',
    action: '',
    target: '',
    outcome: '',
    requestId: '',
  })
  const [sortKey, setSortKey] = useState<SortKey>('occurredAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const currentCursor = stack[stack.length - 1]
  const pageIndex = stack.length - 1

  const fetchPage = useCallback(
    async (size: PageSize, cursor: AuditCursor | undefined) => {
      setRecords(null)
      setLoadError(null)
      try {
        if (size === 'all') {
          const all: AuditRecord[] = []
          let after: AuditCursor | undefined = undefined
          // Loop until the server returns no next cursor. Per-request cap
          // is enforced by the backend (MaxLimit=500).
          for (;;) {
            const resp = await listAudit({ limit: ALL_LIMIT, after })
            all.push(...resp.records)
            if (!resp.next) break
            after = resp.next
          }
          setRecords(all)
          setNextCursor(undefined)
        } else {
          const resp = await listAudit({ limit: size, after: cursor })
          setRecords(resp.records)
          setNextCursor(resp.next)
        }
        setExpanded(new Set())
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e))
      }
    },
    [],
  )

  useEffect(() => {
    void fetchPage(pageSize, currentCursor)
  }, [fetchPage, pageSize, currentCursor])

  const onChangePageSize = (size: PageSize) => {
    setSizeOpen(false)
    setPageSize(size)
    setStack([undefined])
  }

  const onNext = () => {
    if (!nextCursor) return
    setStack((s) => [...s, nextCursor])
  }

  const onPrev = () => {
    if (stack.length <= 1) return
    setStack((s) => s.slice(0, -1))
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  const filteredRecords = useMemo(() => {
    if (!records) return null
    const f = {
      occurredAt: filters.occurredAt.trim().toLowerCase(),
      actor: filters.actor.trim().toLowerCase(),
      action: filters.action.trim().toLowerCase(),
      target: filters.target.trim().toLowerCase(),
      outcome: filters.outcome.trim().toLowerCase(),
      requestId: filters.requestId.trim().toLowerCase(),
    }
    const rows = records.filter((r) => {
      if (f.occurredAt && !formatTime(r.occurredAt).toLowerCase().includes(f.occurredAt))
        return false
      if (f.actor && !formatActor(r).toLowerCase().includes(f.actor)) return false
      if (f.action && !r.action.toLowerCase().includes(f.action)) return false
      if (f.target && !formatTarget(r).toLowerCase().includes(f.target)) return false
      if (
        f.outcome &&
        !(OUTCOME_LABELS[r.outcome]?.text.toLowerCase() ?? r.outcome).includes(
          f.outcome,
        )
      )
        return false
      if (f.requestId && !(r.requestId ?? '').toLowerCase().includes(f.requestId))
        return false
      return true
    })
    rows.sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortKey === 'occurredAt') {
        av = new Date(a.occurredAt).getTime()
        bv = new Date(b.occurredAt).getTime()
      } else if (sortKey === 'actor') {
        av = formatActor(a).toLowerCase()
        bv = formatActor(b).toLowerCase()
      } else if (sortKey === 'action') {
        av = a.action.toLowerCase()
        bv = b.action.toLowerCase()
      } else if (sortKey === 'target') {
        av = formatTarget(a).toLowerCase()
        bv = formatTarget(b).toLowerCase()
      } else if (sortKey === 'outcome') {
        av = a.outcome
        bv = b.outcome
      } else {
        av = (a.requestId ?? '').toLowerCase()
        bv = (b.requestId ?? '').toLowerCase()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return rows
  }, [records, filters, sortKey, sortDir])

  return (
    <>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1">Audit log</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Select
                isOpen={sizeOpen}
                selected={pageSize}
                onSelect={(_, value) => onChangePageSize(value as PageSize)}
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
          <Alert variant="danger" title="Could not load audit log" isInline>
            {loadError}
          </Alert>
        )}
        {!loadError && records === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {records !== null && records.length === 0 && pageIndex === 0 && (
          <EmptyState titleText="No audit records" headingLevel="h2">
            <EmptyStateBody>
              Privileged actions like login and system changes appear here as
              they happen.
            </EmptyStateBody>
          </EmptyState>
        )}
        {records !== null && records.length === 0 && pageIndex > 0 && (
          <EmptyState titleText="No more records" headingLevel="h2">
            <EmptyStateBody>
              This page is past the end of the audit log. Use Previous to go
              back.
            </EmptyStateBody>
          </EmptyState>
        )}
        {filteredRecords !== null && records !== null && records.length > 0 && (
          <Table aria-label="Audit log" variant="compact">
            <Thead>
              <Tr>
                <Th screenReaderText="Expand details" />
                <Th width={15} sort={sortFor('occurredAt', 1)}>
                  Time
                </Th>
                <Th width={15} sort={sortFor('actor', 2)}>
                  Actor
                </Th>
                <Th width={20} sort={sortFor('action', 3)}>
                  Action
                </Th>
                <Th width={20} sort={sortFor('target', 4)}>
                  Target
                </Th>
                <Th width={10} sort={sortFor('outcome', 5)}>
                  Outcome
                </Th>
                <Th width={20} sort={sortFor('requestId', 6)}>
                  Request ID
                </Th>
              </Tr>
              <Tr>
                <Th screenReaderText="Expand spacer" />
                <Th>
                  <SearchInput
                    aria-label="Filter time"
                    placeholder="Filter time"
                    value={filters.occurredAt}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, occurredAt: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, occurredAt: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter actor"
                    placeholder="Filter actor"
                    value={filters.actor}
                    onChange={(_, v) => setFilters((f) => ({ ...f, actor: v }))}
                    onClear={() => setFilters((f) => ({ ...f, actor: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter action"
                    placeholder="Filter action"
                    value={filters.action}
                    onChange={(_, v) => setFilters((f) => ({ ...f, action: v }))}
                    onClear={() => setFilters((f) => ({ ...f, action: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter target"
                    placeholder="Filter target"
                    value={filters.target}
                    onChange={(_, v) => setFilters((f) => ({ ...f, target: v }))}
                    onClear={() => setFilters((f) => ({ ...f, target: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter outcome"
                    placeholder="Filter outcome"
                    value={filters.outcome}
                    onChange={(_, v) => setFilters((f) => ({ ...f, outcome: v }))}
                    onClear={() => setFilters((f) => ({ ...f, outcome: '' }))}
                  />
                </Th>
                <Th>
                  <SearchInput
                    aria-label="Filter request ID"
                    placeholder="Filter request ID"
                    value={filters.requestId}
                    onChange={(_, v) =>
                      setFilters((f) => ({ ...f, requestId: v }))
                    }
                    onClear={() => setFilters((f) => ({ ...f, requestId: '' }))}
                  />
                </Th>
              </Tr>
            </Thead>
            {filteredRecords.map((r, i) => {
              const isExpanded = expanded.has(r.id)
              const outcome = OUTCOME_LABELS[r.outcome] ?? OUTCOME_LABELS.success
              return (
                <Tbody key={r.id} isExpanded={isExpanded}>
                  <Tr>
                    <Td
                      expand={{
                        rowIndex: i,
                        isExpanded,
                        onToggle: () => toggleExpand(r.id),
                        expandId: `audit-row-${r.id}`,
                      }}
                    />
                    <Td dataLabel="Time">{formatTime(r.occurredAt)}</Td>
                    <Td dataLabel="Actor">{formatActor(r)}</Td>
                    <Td dataLabel="Action" modifier="truncate">
                      {r.action}
                    </Td>
                    <Td dataLabel="Target" modifier="truncate">
                      {formatTarget(r)}
                    </Td>
                    <Td dataLabel="Outcome">
                      <Label color={outcome.color} isCompact>
                        {outcome.text}
                      </Label>
                    </Td>
                    <Td dataLabel="Request ID" modifier="truncate">
                      {r.requestId || '—'}
                    </Td>
                  </Tr>
                  <Tr isExpanded={isExpanded}>
                    <Td colSpan={7}>
                      <ExpandableRowContent>
                        <AuditDetail record={r} />
                      </ExpandableRowContent>
                    </Td>
                  </Tr>
                </Tbody>
              )
            })}
          </Table>
        )}
      </PageSection>

      {records !== null && pageSize !== 'all' && (records.length > 0 || pageIndex > 0) && (
        <PageSection>
          <Toolbar>
            <ToolbarContent>
              <ToolbarItem>
                <Button variant="secondary" isDisabled={pageIndex === 0} onClick={onPrev}>
                  Previous
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  isDisabled={!nextCursor}
                  onClick={onNext}
                >
                  Next
                </Button>
              </ToolbarItem>
              <ToolbarItem>Page {pageIndex + 1}</ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        </PageSection>
      )}
    </>
  )
}

function AuditDetail({ record }: { record: AuditRecord }) {
  return (
    <dl>
      <dt>ID</dt>
      <dd>
        <code>{record.id}</code>
      </dd>
      {record.requestIp && (
        <>
          <dt>Request IP</dt>
          <dd>{record.requestIp}</dd>
        </>
      )}
      {record.detail && Object.keys(record.detail).length > 0 && (
        <>
          <dt>Detail</dt>
          <dd>
            <pre style={{ margin: 0 }}>{JSON.stringify(record.detail, null, 2)}</pre>
          </dd>
        </>
      )}
    </dl>
  )
}
