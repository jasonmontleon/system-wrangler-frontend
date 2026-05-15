// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type Role = 'admin' | 'operator' | 'auditor'

export type RoleAssignment = {
  userId: string
  username: string
  groupId: string | null
  groupName?: string
  role: Role
}

// Scope summarizes the caller's role assignments. `global` is "" when
// the caller holds no install-wide role; `groups` maps each visible
// group id to the caller's highest role on it (admin > operator >
// auditor). Mirrors the JSON shape of GET /api/me/scope.
export type Scope = {
  global: Role | ''
  groups: Record<string, Role>
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

export async function fetchMyScope(): Promise<Scope> {
  const resp = await apiFetch('/api/me/scope')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { global?: Role | ''; groups?: Record<string, Role> }
  return { global: body.global ?? '', groups: body.groups ?? {} }
}

export async function listGroupRoleAssignments(
  groupId: string,
): Promise<RoleAssignment[]> {
  const resp = await apiFetch(
    `/api/groups/${encodeURIComponent(groupId)}/role-assignments`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { assignments: RoleAssignment[] }
  return body.assignments
}

export async function grantGroupRole(
  groupId: string,
  userId: string,
  role: Role,
): Promise<RoleAssignment> {
  const resp = await apiFetch(
    `/api/groups/${encodeURIComponent(groupId)}/role-assignments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as RoleAssignment
}

export async function revokeGroupRole(
  groupId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const resp = await apiFetch(
    `/api/groups/${encodeURIComponent(groupId)}/role-assignments/${encodeURIComponent(
      userId,
    )}/${encodeURIComponent(role)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listAdminRoleAssignments(): Promise<RoleAssignment[]> {
  const resp = await apiFetch('/api/admin/role-assignments')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { assignments: RoleAssignment[] }
  return body.assignments
}

export async function grantAdminRole(
  userId: string,
  groupId: string | null,
  role: Role,
): Promise<RoleAssignment> {
  const resp = await apiFetch('/api/admin/role-assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, groupId, role }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as RoleAssignment
}

export async function revokeAdminRole(
  userId: string,
  groupId: string | null,
  role: Role,
): Promise<void> {
  const resp = await apiFetch('/api/admin/role-assignments', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, groupId, role }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
