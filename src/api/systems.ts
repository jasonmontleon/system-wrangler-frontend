// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import type { Label } from './labels'
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
  // isWindows is the operator-declared platform flag. True means the
  // Ansible runner uses the PowerShell-on-OpenSSH path
  // (ansible_shell_type=powershell in inventory, win_ping / win_command
  // modules); false / absent treats the host as Unix-like.
  isWindows?: boolean
  // running is true when an updater (inspect / check / apply) is
  // currently in flight against this system. Derived server-side from
  // updater_run_locks so a spinner survives page navigation and
  // appears even when work was initiated from another tab.
  running?: boolean
  // osFamily / osDistribution / virtualization are detected platform
  // facts populated by the inspect playbook's SW_OS_* and
  // SW_VIRTUALIZATION markers. Empty pre-inspect; the SPA renders an
  // OS icon next to the row name when osFamily is one of the
  // recognized values and a Hardware row on the detail page when
  // virtualization is set.
  osFamily?: string
  osDistribution?: string
  virtualization?: string
  // labels carries the full set of (key, value) tags attached to this
  // system. Inlined in the list response so the SPA can render chips
  // and click-to-filter without an N+1 per-row fetch. Absent / empty
  // when no labels are set on the system.
  labels?: Label[]
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

// listSystems fetches the systems list. When a non-empty `labels`
// selector is supplied (k8s-subset grammar; see /api/labels OpenAPI
// docs), the backend filters the result to systems whose labels
// satisfy every comma-joined requirement.
export async function listSystems(options?: {
  labels?: string
}): Promise<System[]> {
  let url = '/api/systems'
  const sel = options?.labels?.trim()
  if (sel) {
    url += `?labels=${encodeURIComponent(sel)}`
  }
  const resp = await apiFetch(url)
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

export async function setSystemPlatform(id: string, isWindows: boolean): Promise<void> {
  const resp = await apiFetch(`/api/systems/${encodeURIComponent(id)}/platform`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isWindows }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
