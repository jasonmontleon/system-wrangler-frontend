// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Card,
  CardBody,
  CardTitle,
  FormSelect,
  FormSelectOption,
  Label,
  Spinner,
  Stack,
  StackItem,
  Title,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  listEffectiveSystemExclusions,
  type Exclusion,
  type ExclusionScope,
} from '../api/exclusions'
import type { SystemUpdater } from '../api/updaters'

export type EffectiveExclusionsCardProps = {
  systemId: string
  updaters: SystemUpdater[]
}

// EffectiveExclusionsCard renders the resolved union of global +
// group + system exclusions for one (system, updater) pair. The
// operator picks an updater detected on this host; the table shows
// every pattern that will be skipped on the next Apply along with
// the scope it came from and a link to the surface where the
// owning row can be edited.
export default function EffectiveExclusionsCard({
  systemId,
  updaters,
}: EffectiveExclusionsCardProps) {
  const installedUpdaters = useMemo(
    () => updaters.filter((u) => u.installed),
    [updaters],
  )
  const [selected, setSelected] = useState<string>(
    () => installedUpdaters[0]?.updaterId ?? '',
  )
  const [rows, setRows] = useState<Exclusion[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep the selection valid: if updaters are re-fetched and the
  // previously-picked id is no longer installed, drop to the first
  // available one. Empty list → empty selection (renders the
  // no-updaters guard below).
  useEffect(() => {
    if (installedUpdaters.length === 0) {
      setSelected('')
      return
    }
    const stillPresent = installedUpdaters.some((u) => u.updaterId === selected)
    if (!stillPresent) setSelected(installedUpdaters[0]!.updaterId)
  }, [installedUpdaters, selected])

  const load = useCallback(async (updaterId: string) => {
    if (!updaterId) {
      setRows(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const got = await listEffectiveSystemExclusions(systemId, updaterId)
      setRows(got)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [systemId])

  useEffect(() => {
    void load(selected)
  }, [load, selected])

  return (
    <Card>
      <CardTitle>
        <Stack hasGutter>
          <StackItem>
            <Title headingLevel="h2" size="lg">
              Effective exclusions
            </Title>
          </StackItem>
          <StackItem>
            <span style={{ fontWeight: 400 }}>
              The union of fleet, group, and system rules applied at the next
              Update for the selected updater. Use the source badge to find the
              row that owns each pattern.
            </span>
          </StackItem>
        </Stack>
      </CardTitle>
      <CardBody>
        <Stack hasGutter>
          {installedUpdaters.length === 0 ? (
            <StackItem>
              <em>No updaters have been detected on this system yet — run Inspect to populate the list.</em>
            </StackItem>
          ) : (
            <>
              <StackItem>
                <FormSelect
                  id="effective-exclusions-updater"
                  aria-label="Updater"
                  value={selected}
                  onChange={(_e, v) => setSelected(v)}
                  style={{ maxWidth: '24rem' }}
                >
                  {installedUpdaters.map((u) => (
                    <FormSelectOption
                      key={u.updaterId}
                      value={u.updaterId}
                      label={u.displayName || u.updaterId}
                    />
                  ))}
                </FormSelect>
              </StackItem>
              {error && (
                <StackItem>
                  <Alert
                    variant="danger"
                    title="Failed to load effective exclusions"
                    isInline
                  >
                    {error}
                  </Alert>
                </StackItem>
              )}
              <StackItem>
                {loading ? (
                  <Spinner aria-label="Loading effective exclusions" />
                ) : !rows || rows.length === 0 ? (
                  <em>No exclusions apply to this updater on this system.</em>
                ) : (
                  <Table aria-label="Effective exclusions" variant="compact">
                    <Thead>
                      <Tr>
                        <Th>Pattern</Th>
                        <Th>Updater</Th>
                        <Th>Source</Th>
                        <Th aria-label="Manage at" />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {rows.map((r) => (
                        <Tr key={r.id}>
                          <Td dataLabel="Pattern">
                            <code>{r.pattern}</code>
                          </Td>
                          <Td dataLabel="Updater">{r.updater}</Td>
                          <Td dataLabel="Source">
                            <Label color={sourceColor(r.scope)} isCompact>
                              {r.scope}
                            </Label>
                          </Td>
                          <Td dataLabel="Manage at">
                            <ManageAt scope={r.scope} targetId={r.targetId} />
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                )}
              </StackItem>
            </>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}

function ManageAt({
  scope,
  targetId,
}: {
  scope: ExclusionScope
  targetId?: string
}) {
  switch (scope) {
    case 'global':
      return <Link to="/exclusions">Admin → Exclusions</Link>
    case 'group':
      return targetId ? (
        <Link to={`/groups/${encodeURIComponent(targetId)}`}>
          Group → Exclusions
        </Link>
      ) : (
        <span>—</span>
      )
    case 'system':
      return <span>This system</span>
  }
}

function sourceColor(s: ExclusionScope): 'blue' | 'purple' | 'orange' {
  switch (s) {
    case 'global':
      return 'blue'
    case 'group':
      return 'purple'
    case 'system':
      return 'orange'
  }
}
