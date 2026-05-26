// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

// Exclusion mirrors the backend's package_exclusions row. `targetId` is
// empty for global-scope rows, the group id for group-scope rows, the
// system id for system-scope rows. Patterns are verbatim — each
// updater's apply.yml uses them in its native syntax.
export type ExclusionScope = 'global' | 'group' | 'system'

export type Exclusion = {
  id: string
  scope: ExclusionScope
  targetId?: string
  updater: string
  pattern: string
  reason?: string
  createdAt: string
  createdBy: string
}

// ExclusionInput is the user-supplied subset accepted on create. The
// route fixes scope + targetId — the body never carries them.
export type ExclusionInput = {
  updater: string
  pattern: string
  reason?: string
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

export async function listGlobalExclusions(): Promise<Exclusion[]> {
  const resp = await apiFetch('/api/admin/package-exclusions')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Exclusion[]
}

export async function createGlobalExclusion(
  input: ExclusionInput,
): Promise<Exclusion> {
  const resp = await apiFetch('/api/admin/package-exclusions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Exclusion
}

export async function deleteGlobalExclusion(id: string): Promise<void> {
  const resp = await apiFetch(
    `/api/admin/package-exclusions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listGroupExclusions(
  groupId: string,
): Promise<Exclusion[]> {
  const resp = await apiFetch(
    `/api/groups/${encodeURIComponent(groupId)}/package-exclusions`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Exclusion[]
}

export async function createGroupExclusion(
  groupId: string,
  input: ExclusionInput,
): Promise<Exclusion> {
  const resp = await apiFetch(
    `/api/groups/${encodeURIComponent(groupId)}/package-exclusions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Exclusion
}

export async function deleteGroupExclusion(
  groupId: string,
  exclusionId: string,
): Promise<void> {
  const resp = await apiFetch(
    `/api/groups/${encodeURIComponent(groupId)}/package-exclusions/${encodeURIComponent(exclusionId)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listSystemExclusions(
  systemId: string,
): Promise<Exclusion[]> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/package-exclusions`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Exclusion[]
}

export async function createSystemExclusion(
  systemId: string,
  input: ExclusionInput,
): Promise<Exclusion> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/package-exclusions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Exclusion
}

export async function deleteSystemExclusion(
  systemId: string,
  exclusionId: string,
): Promise<void> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/package-exclusions/${encodeURIComponent(exclusionId)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

// listEffectiveSystemExclusions returns the resolved union for one
// (system, updater) pair. Used by the SystemDetail "what will be
// skipped" card so the operator can see exactly which patterns will
// apply on the next Update — and which scope each came from.
export async function listEffectiveSystemExclusions(
  systemId: string,
  updater: string,
): Promise<Exclusion[]> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/package-exclusions/effective?updater=${encodeURIComponent(updater)}`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Exclusion[]
}
