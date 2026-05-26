// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import ExclusionsCard from './ExclusionsCard'
import {
  createGroupExclusion,
  deleteGroupExclusion,
  listGroupExclusions,
  type Exclusion,
  type ExclusionInput,
} from '../api/exclusions'
import {
  listUpdaterDefinitions,
  type UpdaterDefinition,
} from '../api/updaters'

// GroupExclusionsTab wraps ExclusionsCard for one group. Reads happen
// for any caller who can read the group; writes require canManage,
// which is passed from the parent based on rbac.canAdminGroup.
export type GroupExclusionsTabProps = {
  groupId: string
  canManage: boolean
}

export default function GroupExclusionsTab({
  groupId,
  canManage,
}: GroupExclusionsTabProps) {
  const [rows, setRows] = useState<Exclusion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updaters, setUpdaters] = useState<UpdaterDefinition[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [rs, defs] = await Promise.all([
        listGroupExclusions(groupId),
        listUpdaterDefinitions(),
      ])
      setRows(rs)
      setUpdaters(defs)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onCreate = async (input: ExclusionInput) => {
    await createGroupExclusion(groupId, input)
    await refresh()
  }
  const onDelete = async (row: Exclusion) => {
    await deleteGroupExclusion(groupId, row.id)
    await refresh()
  }

  return (
    <ExclusionsCard
      title="Group exclusions"
      description="Patterns added here apply to every system in this group, layered on top of fleet-wide exclusions."
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
