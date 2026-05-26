// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import ExclusionsCard from './ExclusionsCard'
import {
  createSystemExclusion,
  deleteSystemExclusion,
  listSystemExclusions,
  type Exclusion,
  type ExclusionInput,
} from '../api/exclusions'
import {
  listUpdaterDefinitions,
  type UpdaterDefinition,
} from '../api/updaters'

// SystemExclusionsCard surfaces the per-system exclusion list on the
// System Detail → Updaters tab. Higher-scope rows (global + group)
// also apply at apply time but live in their own admin / group
// surfaces; this card focuses on what the operator can change for
// just this host.
export type SystemExclusionsCardProps = {
  systemId: string
  canManage: boolean
}

export default function SystemExclusionsCard({
  systemId,
  canManage,
}: SystemExclusionsCardProps) {
  const [rows, setRows] = useState<Exclusion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updaters, setUpdaters] = useState<UpdaterDefinition[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [rs, defs] = await Promise.all([
        listSystemExclusions(systemId),
        listUpdaterDefinitions(),
      ])
      setRows(rs)
      setUpdaters(defs)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [systemId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onCreate = async (input: ExclusionInput) => {
    await createSystemExclusion(systemId, input)
    await refresh()
  }
  const onDelete = async (row: Exclusion) => {
    await deleteSystemExclusion(systemId, row.id)
    await refresh()
  }

  return (
    <ExclusionsCard
      title="System exclusions"
      description="Patterns added here apply only to this system. Fleet-wide and group exclusions still layer on top — the union of all three controls what the next Update skips."
      rows={rows}
      loadError={loadError ?? undefined}
      loading={loading}
      canManage={canManage}
      updaters={updaters}
      onCreate={onCreate}
      onDelete={onDelete}
    />
  )
}
