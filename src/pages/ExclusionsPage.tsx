// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { PageSection, Stack, StackItem, Title } from '@patternfly/react-core'
import ExclusionsCard from '../components/ExclusionsCard'
import {
  createGlobalExclusion,
  deleteGlobalExclusion,
  listGlobalExclusions,
  type Exclusion,
  type ExclusionInput,
} from '../api/exclusions'
import {
  listUpdaterDefinitions,
  type UpdaterDefinition,
} from '../api/updaters'

// ExclusionsPage is the Administration → Exclusions page. Global Admin
// only — the route in App.tsx redirects anyone else away, so the page
// itself can assume the caller can manage rows.
export default function ExclusionsPage() {
  const [rows, setRows] = useState<Exclusion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updaters, setUpdaters] = useState<UpdaterDefinition[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [rs, defs] = await Promise.all([
        listGlobalExclusions(),
        listUpdaterDefinitions(),
      ])
      setRows(rs)
      setUpdaters(defs)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onCreate = async (input: ExclusionInput) => {
    await createGlobalExclusion(input)
    await refresh()
  }
  const onDelete = async (row: Exclusion) => {
    await deleteGlobalExclusion(row.id)
    await refresh()
  }

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1" size="2xl">
            Package exclusions
          </Title>
        </StackItem>
        <StackItem>
          <ExclusionsCard
            title="Global exclusions"
            description="Patterns added here apply to every system. Group and system scopes layer on top — exclusions union across all three."
            rows={rows}
            loadError={loadError ?? undefined}
            loading={loading}
            canManage
            updaters={updaters}
            onCreate={onCreate}
            onDelete={onDelete}
          />
        </StackItem>
      </Stack>
    </PageSection>
  )
}
