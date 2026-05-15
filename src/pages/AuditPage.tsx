// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type AuditListParams,
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

// FILTER_DEBOUNCE_MS is how long the page waits after the last
// keystroke before issuing a new query. Short enough to feel
// responsive when an operator stops typing; long enough that
// typing through a 10-character substring doesn't fire ten
// requests.
const FILTER_DEBOUNCE_MS = 300

const KNOWN_OUTCOMES: AuditOutcome[] = ['success', 'failure', 'denied']

// matchOutcome accepts the user's free-text outcome filter and returns
// it as a canonical AuditOutcome when the text is an unambiguous match
// for one of the three known values (case-insensitive prefix). The
// backend's outcome filter is exact-match, so any input that doesn't
// resolve cleanly is passed up as `undefined` — better to show
// everything than to silently mismatch.
function matchOutcome(input: string): AuditOutcome | undefined {
  const v = input.trim().toLowerCase()
  if (!v) return undefined
  const hits = KNOWN_OUTCOMES.filter((o) => o.startsWith(v))
  return hits.length === 1 ? hits[0] : undefined
}

// parseDayRange parses a strict YYYY-MM-DD input as a UTC day range
// (since=that midnight, until=next midnight). Returns null for any
// other input shape so the caller can leave the filter unset.
function parseDayRange(
  input: string,
): { sinceMs: number; untilMs: number } | null {
  const v = input.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const ms = Date.parse(v + 'T00:00:00Z')
  if (Number.isNaN(ms)) return null
  return { sinceMs: ms, untilMs: ms + 24 * 60 * 60 * 1000 }
}

// filterParamsFor compiles the visible filter state into the
// AuditListParams shape the backend understands. The mapping is
// deliberately lossy where the backend can't match the UI's
// substring semantics: outcome is exact (so partial input is
// dropped), and occurredAt only fires on a complete YYYY-MM-DD.
function filterParamsFor(filters: Record<string, string>): AuditListParams {
  const params: AuditListParams = {}
  const action = filters.action.trim()
  if (action) {
    // The backend treats a trailing '*' as a prefix; auto-append
    // one so "auth" matches "auth.login.failed" the way operators
    // intuitively expect from a typeahead.
    params.action = action.endsWith('*') ? action : action + '*'
  }
  const actor = filters.actor.trim()
  if (actor) params.actorLabel = actor
  const target = filters.target.trim()
  if (target) params.targetLabel = target
  const outcome = matchOutcome(filters.outcome)
  if (outcome) params.outcome = outcome
  const reqID = filters.requestId.trim()
  if (reqID) params.requestId = reqID
  const range = parseDayRange(filters.occurredAt)
  if (range) {
    params.sinceMs = range.sinceMs
    params.untilMs = range.untilMs
  }
  return params
}

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
  // debouncedFilters trails the visible filter state by
  // FILTER_DEBOUNCE_MS so the network doesn't fire on every
  // keystroke. The page reads this — not `filters` — when
  // assembling the listAudit query.
  const [debouncedFilters, setDebouncedFilters] = useState(filters)
  useEffect(() => {
    const id = window.setTimeout(
      () => setDebouncedFilters(filters),
      FILTER_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(id)
  }, [filters])
  const filterParams = useMemo(
    () => filterParamsFor(debouncedFilters),
    [debouncedFilters],
  )
  // filtersKey is the dependency the cursor-reset effect watches so
  // it doesn't trigger on object identity. Keeps the cursor stable
  // when an unrelated keystroke (e.g. partial outcome input) leaves
  // the resolved filterParams unchanged.
  const filtersKey = JSON.stringify(filterParams)
  const [sortKey, setSortKey] = useState<SortKey>('occurredAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const currentCursor = stack[stack.length - 1]
  const pageIndex = stack.length - 1

  // Resolved filter set changed → roll the cursor stack back to
  // the first page so the next fetch starts at the head of the
  // newly-filtered result set. Skip on the initial render: the
  // initial filterParams is the empty object and rolling back to
  // [undefined] when we're already at [undefined] would be a
  // no-op that still triggers a render.
  const firstFiltersKey = useRef(filtersKey)
  useEffect(() => {
    if (filtersKey === firstFiltersKey.current) return
    setStack([undefined])
  }, [filtersKey])

  const fetchPage = useCallback(
    async (
      size: PageSize,
      cursor: AuditCursor | undefined,
      params: AuditListParams,
    ) => {
      // Deliberately leave `records` in place across a refetch. A
      // debounced filter keystroke that called setRecords(null) here
      // would unmount the <Table> (and its <Thead> filter inputs),
      // pulling focus away from whatever the operator was typing
      // into. Stale rows linger for ~50ms until the response lands;
      // the initial null-records gate (records === null) still
      // shows the spinner on first load.
      setLoadError(null)
      try {
        if (size === 'all') {
          const all: AuditRecord[] = []
          let after: AuditCursor | undefined = undefined
          // Loop until the server returns no next cursor. Per-request cap
          // is enforced by the backend (MaxLimit=500).
          for (;;) {
            const resp = await listAudit({ ...params, limit: ALL_LIMIT, after })
            all.push(...resp.records)
            if (!resp.next) break
            after = resp.next
          }
          setRecords(all)
          setNextCursor(undefined)
        } else {
          const resp = await listAudit({ ...params, limit: size, after: cursor })
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
    void fetchPage(pageSize, currentCursor, filterParams)
  }, [fetchPage, pageSize, currentCursor, filterParams])

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

  // Filtering happens server-side via debouncedFilters → filterParams
  // → listAudit. This memo only re-sorts the page the server already
  // returned; the default order is occurred_at DESC (backend), so the
  // client-side sort is for column-header overrides like
  // "sort by action."
  const filteredRecords = useMemo(() => {
    if (!records) return null
    const rows = [...records]
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
  }, [records, sortKey, sortDir])

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
        {filteredRecords !== null && records !== null && (
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
                    placeholder="YYYY-MM-DD"
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
                    placeholder="success / failure / denied"
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
            {filteredRecords.length === 0 && (
              <Tbody>
                <Tr>
                  <Td colSpan={7}>
                    <EmptyAuditRow
                      hasFilters={Object.keys(filterParams).length > 0}
                      pageIndex={pageIndex}
                    />
                  </Td>
                </Tr>
              </Tbody>
            )}
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

// EmptyAuditRow renders the "nothing here" content inside the Table
// body so the surrounding Thead — and its filter row — stays
// mounted. Rendering an EmptyState outside the Table would unmount
// the SearchInputs, and the operator who just typed too-restrictive
// a filter would have no way to relax it.
function EmptyAuditRow({
  hasFilters,
  pageIndex,
}: {
  hasFilters: boolean
  pageIndex: number
}) {
  if (hasFilters) {
    return (
      <EmptyState
        titleText="No records match the current filters"
        headingLevel="h2"
      >
        <EmptyStateBody>
          Clear or relax the filters above to widen the search.
        </EmptyStateBody>
      </EmptyState>
    )
  }
  if (pageIndex > 0) {
    return (
      <EmptyState titleText="No more records" headingLevel="h2">
        <EmptyStateBody>
          This page is past the end of the audit log. Use Previous to go
          back.
        </EmptyStateBody>
      </EmptyState>
    )
  }
  return (
    <EmptyState titleText="No audit records" headingLevel="h2">
      <EmptyStateBody>
        Privileged actions like login and system changes appear here as
        they happen.
      </EmptyStateBody>
    </EmptyState>
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
