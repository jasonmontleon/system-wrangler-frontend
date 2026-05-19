// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type UpdaterSource = 'builtin' | 'custom'

export type UpdaterRunKind = 'inspect' | 'check' | 'apply'

export type UpdaterRunStatus =
  | 'success'
  | 'failure'
  | 'host_key_mismatch'
  | 'no_accepted_host_key'
  | 'missing_credentials'

export type UpdaterDefinition = {
  id: string
  source: UpdaterSource
  displayName: string
  description: string
  detectBinary: string
  checkPlaybook: string
  applyPlaybook: string
  checkOnly: boolean
  createdBy?: string
  createdAt?: string
  updatedAt?: string
}

export type UpdaterDefinitionInput = {
  id: string
  displayName: string
  description: string
  detectBinary: string
  checkPlaybook: string
  applyPlaybook: string
  checkOnly: boolean
}

export type UpdaterDefinitionPatch = Omit<UpdaterDefinitionInput, 'id'>

export type InspectResult = {
  runId: string
  status: UpdaterRunStatus
  exitCode: number
  reason?: string
  detected: string[]
  removed?: string[]
  durationMs: number
}

export type UpdaterRunResult = {
  runId: string
  updaterId: string
  kind: UpdaterRunKind
  status: UpdaterRunStatus
  exitCode: number
  affectedCount: number
  reason?: string
  durationMs: number
}

export type UpdaterRun = {
  id: string
  systemId: string
  updaterId?: string
  kind: UpdaterRunKind
  startedAt: string
  finishedAt?: string
  exitCode?: number
  actorId?: string
  playbookSha?: string
  logTail?: string
}

export type UpdaterConflict = {
  error: string
  conflictingRun?: string
}

// PendingPackage is one entry surfaced by a check playbook's
// SW_PENDING_PACKAGE markers. Either version may be empty —
// flatpak and snap can only cheaply surface the new version, and
// legacy custom updaters that emit only a name arrive with both
// versions blank.
export type PendingPackage = {
  name: string
  oldVersion: string
  newVersion: string
}

// SystemUpdater is one row from GET /api/systems/{id}/updaters —
// the union of every registered updater with this system's
// detection + enablement state. Drives the per-system Capabilities
// card on the detail page.
export type SystemUpdater = {
  updaterId: string
  source: UpdaterSource
  displayName: string
  installed: boolean
  enabled: boolean
  // checkOnly is true when the updater is registered as check-only;
  // the SPA hides per-row Update / excludes from bulk Update fan-outs
  // and the backend rejects Apply with 409.
  checkOnly: boolean
  lastSeenAt?: string
  // pendingPackages is the list the most recent check run surfaced
  // via SW_PENDING_PACKAGE markers. Empty for updaters whose check
  // playbook does not emit them or that have never been checked.
  pendingPackages: PendingPackage[]
}

async function parseError(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // fall through
  }
  return resp.statusText || `HTTP ${resp.status}`
}

// listUpdaterDefinitions returns builtins + non-deleted custom
// updaters unioned. Available to any authenticated user — the
// Capabilities panel uses it to know what's even registerable
// before any inspection has happened.
export async function listUpdaterDefinitions(): Promise<UpdaterDefinition[]> {
  const resp = await apiFetch('/api/admin/updater-definitions')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { definitions: UpdaterDefinition[] }
  return body.definitions
}

// createUpdaterDefinition runs the full server-side guard chain
// (validate → credential heuristic → ansible --syntax-check) and
// either returns the saved canonical row or rejects with 400/409.
export async function createUpdaterDefinition(
  input: UpdaterDefinitionInput,
): Promise<UpdaterDefinition> {
  const resp = await apiFetch('/api/admin/updater-definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as UpdaterDefinition
}

export async function updateUpdaterDefinition(
  id: string,
  patch: UpdaterDefinitionPatch,
): Promise<UpdaterDefinition> {
  const resp = await apiFetch(
    `/api/admin/updater-definitions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as UpdaterDefinition
}

export async function deleteUpdaterDefinition(id: string): Promise<void> {
  const resp = await apiFetch(
    `/api/admin/updater-definitions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok && resp.status !== 404) {
    throw new ApiError(resp.status, await parseError(resp))
  }
}

// inspectSystem composes the registry-wide detection playbook and
// runs it against the system. Returns the resolved availability
// plus deltas.
export async function inspectSystem(systemId: string): Promise<InspectResult> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/inspect`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as InspectResult
}

export async function checkUpdater(
  systemId: string,
  updaterId: string,
): Promise<UpdaterRunResult> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/updaters/${encodeURIComponent(updaterId)}/check`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as UpdaterRunResult
}

export async function applyUpdater(
  systemId: string,
  updaterId: string,
): Promise<UpdaterRunResult> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/updaters/${encodeURIComponent(updaterId)}/apply`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as UpdaterRunResult
}

export async function listUpdaterRuns(
  systemId: string,
  limit = 50,
): Promise<UpdaterRun[]> {
  const url = `/api/systems/${encodeURIComponent(systemId)}/updater-runs?limit=${limit}`
  const resp = await apiFetch(url)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { runs: UpdaterRun[] }
  return body.runs
}

// listSystemUpdaters returns every registered updater × this
// system's detection + enablement state. Use this on the system
// detail page; the simpler list endpoint at /api/admin/updater-
// definitions is only the global registry view.
export async function listSystemUpdaters(
  systemId: string,
): Promise<SystemUpdater[]> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/updaters`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { updaters: SystemUpdater[] }
  return body.updaters
}

export async function setUpdaterEnabled(
  systemId: string,
  updaterId: string,
  enabled: boolean,
): Promise<void> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/updaters/${encodeURIComponent(updaterId)}/enabled`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
