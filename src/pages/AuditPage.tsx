// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateBody,
  Label,
  PageSection,
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

const PAGE_SIZES = [25, 50, 100] as const
type PageSize = (typeof PAGE_SIZES)[number]

const OUTCOME_LABELS: Record<AuditOutcome, { color: 'green' | 'red' | 'orange'; text: string }> = {
  success: { color: 'green', text: 'Success' },
  failure: { color: 'red', text: 'Failure' },
  denied: { color: 'orange', text: 'Denied' },
}

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

export default function AuditPage() {
  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [sizeOpen, setSizeOpen] = useState(false)
  // History of cursors: stack[i] is the cursor used to fetch page i.
  // stack[0] = undefined means "first page (no cursor)". Push when paging
  // forward; pop when paging back. Length is the current page index + 1.
  const [stack, setStack] = useState<(AuditCursor | undefined)[]>([undefined])
  const [records, setRecords] = useState<AuditRecord[] | null>(null)
  const [nextCursor, setNextCursor] = useState<AuditCursor | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const currentCursor = stack[stack.length - 1]
  const pageIndex = stack.length - 1

  const fetchPage = useCallback(
    async (size: PageSize, cursor: AuditCursor | undefined) => {
      setRecords(null)
      setLoadError(null)
      try {
        const resp = await listAudit({ limit: size, after: cursor })
        setRecords(resp.records)
        setNextCursor(resp.next)
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
    // Reset paging — different page sizes invalidate prior cursors.
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
                    {pageSize} per page
                  </MenuToggle>
                )}
              >
                <SelectList>
                  {PAGE_SIZES.map((n) => (
                    <SelectOption key={n} value={n}>
                      {n} per page
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
        {records !== null && records.length > 0 && (
          <Table aria-label="Audit log" variant="compact">
            <Thead>
              <Tr>
                <Th screenReaderText="Expand details" />
                <Th width={15}>Time</Th>
                <Th width={15}>Actor</Th>
                <Th width={20}>Action</Th>
                <Th width={20}>Target</Th>
                <Th width={10}>Outcome</Th>
                <Th width={20}>Request ID</Th>
              </Tr>
            </Thead>
            {records.map((r, i) => {
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

      {records !== null && (records.length > 0 || pageIndex > 0) && (
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
