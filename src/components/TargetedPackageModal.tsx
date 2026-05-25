// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Checkbox,
  EmptyState,
  EmptyStateBody,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SearchInput,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import type { System } from '../api/systems'
import {
  listSystemUpdaters,
  type SystemUpdater,
} from '../api/updaters'
import type { TargetedSelection } from '../util/updaterFanOut'

export type TargetedPackageModalProps = {
  isOpen: boolean
  onClose: () => void
  systems: System[]
  onSubmit: (selections: TargetedSelection[]) => void | Promise<void>
  busy?: boolean
}

type Row = {
  updaterId: string
  updaterDisplayName: string
  packageName: string
  hostCount: number
  versions: Set<string>
}

function selectionKey(updaterId: string, packageName: string): string {
  return `${updaterId}|${packageName}`
}

function formatVersion(old: string, next: string): string {
  if (!old && !next) return ''
  return `${old || '—'} → ${next || '—'}`
}

// TargetedPackageModal lets the operator pick (updater, package)
// pairs from the union across a selected set of systems. The picker
// fetches each system's per-updater pending list on open so rows
// can be split by updater and the from→to version range shown. The
// fan-out filters per-system to what each updater still has pending
// at submit time so stale picks degrade gracefully.
export default function TargetedPackageModal({
  isOpen,
  onClose,
  systems,
  onSubmit,
  busy,
}: TargetedPackageModalProps) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [perSystem, setPerSystem] = useState<
    Map<string, SystemUpdater[]> | null
  >(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Stable dep so re-render of the parent doesn't re-fire fetches
  // when the selected set hasn't actually changed.
  const systemIdsKey = useMemo(
    () =>
      systems
        .map((s) => s.id)
        .sort()
        .join(','),
    [systems],
  )

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setChosen(new Set())
    setLoadError(null)
    setPerSystem(null)
    if (systems.length === 0) {
      setPerSystem(new Map())
      return
    }
    let cancelled = false
    const ids = systems.map((s) => s.id)
    void Promise.all(
      ids.map((id) =>
        listSystemUpdaters(id)
          .then((u) => [id, u] as const)
          .catch(() => [id, [] as SystemUpdater[]] as const),
      ),
    ).then((entries) => {
      if (cancelled) return
      const map = new Map<string, SystemUpdater[]>()
      let anyError = false
      for (const [id, updaters] of entries) {
        map.set(id, updaters)
        if (updaters.length === 0) anyError = true
      }
      setPerSystem(map)
      if (anyError && map.size < ids.length) {
        setLoadError(
          'Some systems could not be queried for their pending package lists; those hosts are excluded from the picker.',
        )
      }
    })
    return () => {
      cancelled = true
    }
    // systemIdsKey collapses identical selections to one fetch pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, systemIdsKey])

  const rows = useMemo<Row[]>(() => {
    if (!perSystem) return []
    const byKey = new Map<string, Row>()
    for (const updaters of perSystem.values()) {
      // Within one system, dedupe (updater, package) pairs so two
      // updater rows that happen to surface the same package name
      // on the same host count as one host each.
      const seenOnHost = new Set<string>()
      for (const u of updaters) {
        if (!u.installed || !u.enabled || u.checkOnly) continue
        for (const p of u.pendingPackages) {
          const key = selectionKey(u.updaterId, p.name)
          const versionLabel = formatVersion(p.oldVersion, p.newVersion)
          let row = byKey.get(key)
          if (!row) {
            row = {
              updaterId: u.updaterId,
              updaterDisplayName: u.displayName,
              packageName: p.name,
              hostCount: 0,
              versions: new Set(),
            }
            byKey.set(key, row)
          }
          if (!seenOnHost.has(key)) {
            seenOnHost.add(key)
            row.hostCount += 1
          }
          if (versionLabel) row.versions.add(versionLabel)
        }
      }
    }
    const list = Array.from(byKey.values())
    list.sort(
      (a, b) =>
        b.hostCount - a.hostCount ||
        a.packageName.localeCompare(b.packageName) ||
        a.updaterDisplayName.localeCompare(b.updaterDisplayName),
    )
    return list
  }, [perSystem])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.packageName.toLowerCase().includes(q) ||
        r.updaterDisplayName.toLowerCase().includes(q) ||
        r.updaterId.toLowerCase().includes(q),
    )
  }, [rows, query])

  const toggle = (updaterId: string, packageName: string, checked: boolean) => {
    const key = selectionKey(updaterId, packageName)
    setChosen((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const submit = () => {
    if (chosen.size === 0) return
    const selections: TargetedSelection[] = []
    for (const key of chosen) {
      const sep = key.indexOf('|')
      if (sep <= 0) continue
      selections.push({
        updaterId: key.slice(0, sep),
        packageName: key.slice(sep + 1),
      })
    }
    selections.sort(
      (a, b) =>
        a.updaterId.localeCompare(b.updaterId) ||
        a.packageName.localeCompare(b.packageName),
    )
    void onSubmit(selections)
  }

  const submitLabel = (() => {
    if (chosen.size === 0) return 'Update'
    const sysWord = systems.length === 1 ? 'system' : 'systems'
    return `Update ${chosen.size} package${chosen.size === 1 ? '' : 's'} across ${systems.length} ${sysWord}`
  })()

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="targeted-package-title"
    >
      <ModalHeader
        title="Update package across selected systems"
        labelId="targeted-package-title"
      />
      <ModalBody>
        <Stack hasGutter>
          <StackItem>
            <Alert
              variant="info"
              title="Per-system filtering"
              isInline
              isPlain
            >
              The fan-out applies each chosen (updater, package) pair
              only to systems whose latest Check listed it as pending.
              Hosts with no overlap are skipped with a per-row note.
            </Alert>
          </StackItem>
          {loadError && (
            <StackItem>
              <Alert variant="warning" title="Partial picker data" isInline>
                {loadError}
              </Alert>
            </StackItem>
          )}
          <StackItem>
            <SearchInput
              placeholder="Filter packages or updaters"
              value={query}
              onChange={(_, v) => setQuery(v)}
              onClear={() => setQuery('')}
              aria-label="Filter packages"
            />
          </StackItem>
          <StackItem>
            {perSystem === null ? (
              <Bullseye style={{ padding: '2rem' }}>
                <Spinner aria-label="Loading pending packages" />
              </Bullseye>
            ) : rows.length === 0 ? (
              <EmptyState
                titleText="No pending packages on the selected systems"
                headingLevel="h3"
              >
                <EmptyStateBody>
                  Run Check on these systems first so their pending
                  package lists populate, then try again.
                </EmptyStateBody>
              </EmptyState>
            ) : filtered.length === 0 ? (
              <EmptyState
                titleText="No packages match the filter"
                headingLevel="h3"
              >
                <EmptyStateBody>
                  Clear the filter to see the full union.
                </EmptyStateBody>
              </EmptyState>
            ) : (
              <Table
                aria-label="Pending packages across selected systems"
                variant="compact"
              >
                <Thead>
                  <Tr>
                    <Th screenReaderText="Select" />
                    <Th>Updater</Th>
                    <Th>Package</Th>
                    <Th>Version</Th>
                    <Th>Hosts pending</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filtered.map((r) => {
                    const key = selectionKey(r.updaterId, r.packageName)
                    const versionDisplay =
                      r.versions.size === 0
                        ? '—'
                        : r.versions.size === 1
                          ? Array.from(r.versions)[0]
                          : `${r.versions.size} variants`
                    return (
                      <Tr key={key}>
                        <Td>
                          <Checkbox
                            id={`targeted-pkg-${key}`}
                            isChecked={chosen.has(key)}
                            onChange={(_, v) =>
                              toggle(r.updaterId, r.packageName, v)
                            }
                            aria-label={`Select ${r.packageName} on ${r.updaterDisplayName}`}
                          />
                        </Td>
                        <Td>
                          <Stack>
                            <StackItem>{r.updaterDisplayName}</StackItem>
                            <StackItem>
                              <small>{r.updaterId}</small>
                            </StackItem>
                          </Stack>
                        </Td>
                        <Td>
                          <code>{r.packageName}</code>
                        </Td>
                        <Td>
                          {r.versions.size <= 1 ? (
                            <small>{versionDisplay}</small>
                          ) : (
                            <small title={Array.from(r.versions).join(', ')}>
                              {versionDisplay}
                            </small>
                          )}
                        </Td>
                        <Td>{r.hostCount}</Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            )}
          </StackItem>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={submit}
          isDisabled={chosen.size === 0 || busy}
          isLoading={busy}
        >
          {submitLabel}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={busy}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
