// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type Group = {
  id: string
  name: string
  createdAt: string
  systemCount: number
}

export type GroupInput = {
  name: string
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

export async function listGroups(): Promise<Group[]> {
  const resp = await apiFetch('/api/groups')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Group[]
}

export async function createGroup(input: GroupInput): Promise<Group> {
  const resp = await apiFetch('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Group
}

export async function renameGroup(
  id: string,
  input: GroupInput,
): Promise<Group> {
  const resp = await apiFetch(`/api/groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Group
}

export async function deleteGroup(id: string): Promise<void> {
  const resp = await apiFetch(`/api/groups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function setSystemGroup(
  systemId: string,
  groupId: string | null,
): Promise<void> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/group`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId }),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
