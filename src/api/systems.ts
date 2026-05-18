// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import type { PendingPackage } from './updaters'

export type SystemStatus = 'unprobed' | 'reachable' | 'unreachable'

export type System = {
  id: string
  name: string
  hostname: string
  createdAt: string
  status: SystemStatus
  lastSeen?: string
  groupId?: string | null
  // lastCheckedAt and pendingUpdates come from the per-system
  // updater stats hook on the backend; omitted when no check has
  // ever run against the system (renders as "Never" / "—").
  lastCheckedAt?: string
  pendingUpdates?: number
  // pendingPackages is the union across every enabled updater on
  // this system from each updater's latest check. Powers the row
  // hover-tooltip without a per-row /updaters fetch. Absent when
  // no check has produced markers.
  pendingPackages?: PendingPackage[]
  // lastRunFailed flips the row glyph to red when the most recent
  // terminated updater run exited non-zero, even on a reachable
  // system. lastRunReason carries a short summary ("apply exit 2")
  // for the detail page's "Needs Attention" line.
  lastRunFailed?: boolean
  lastRunReason?: string
}

export type SystemInput = {
  name: string
  hostname: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function parseError(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // fall through to status text
  }
  return resp.statusText || `HTTP ${resp.status}`
}

export async function listSystems(): Promise<System[]> {
  const resp = await apiFetch('/api/systems')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as System[]
}

export async function getSystem(id: string): Promise<System> {
  const resp = await apiFetch(`/api/systems/${encodeURIComponent(id)}`)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as System
}

export async function createSystem(input: SystemInput): Promise<System> {
  const resp = await apiFetch('/api/systems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as System
}

export async function deleteSystem(id: string): Promise<void> {
  const resp = await apiFetch(`/api/systems/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
