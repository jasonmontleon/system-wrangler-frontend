// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type CredentialScopeKind = 'global' | 'group' | 'system'
export type CredentialOrigin = 'sw_generated' | 'user_supplied'

export type CredentialSlot = {
  scopeKind: CredentialScopeKind
  scopeId?: string
  ansibleUser?: string
  publicKey?: string
  origin?: CredentialOrigin
  createdAt: string
  updatedAt: string
}

// CredentialUpsert mirrors the backend's wire shape (`internal/credentials`
// handler's upsertRequest). At least one of `ansibleUser`, `key`, or
// `clearKey: true` must be set — the server enforces this, but pass an
// empty object and you'll get a 400. The two PATCH-style affordances
// matter:
//   - `ansibleUser` is a pointer in the wire form: send the field to
//     change it (including empty string to clear), omit it to leave
//     the slot's current value untouched.
//   - `key` and `clearKey` are mutually exclusive. `clearKey: true`
//     removes the slot's existing key without supplying a replacement.
export type CredentialUpsert = {
  ansibleUser?: string
  key?: { origin: CredentialOrigin; privateKeyPem?: string }
  clearKey?: boolean
}

export type EffectiveCredential = {
  ansibleUser: string
  userSource: CredentialScopeKind
  publicKey: string
  keySource: CredentialScopeKind
  keyOrigin: CredentialOrigin
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

export async function listSlots(): Promise<CredentialSlot[]> {
  const resp = await apiFetch('/api/admin/ansible-credentials')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { slots: CredentialSlot[] }
  return body.slots
}

export async function getGlobalSlot(): Promise<CredentialSlot | null> {
  return getSlotAt('/api/admin/ansible-credentials/global')
}

export async function putGlobalSlot(input: CredentialUpsert): Promise<CredentialSlot> {
  return putSlotAt('/api/admin/ansible-credentials/global', input)
}

export async function deleteGlobalSlot(): Promise<void> {
  await deleteSlotAt('/api/admin/ansible-credentials/global')
}

export async function getGroupSlot(groupId: string): Promise<CredentialSlot | null> {
  return getSlotAt(`/api/groups/${encodeURIComponent(groupId)}/ansible-credential`)
}

export async function putGroupSlot(
  groupId: string,
  input: CredentialUpsert,
): Promise<CredentialSlot> {
  return putSlotAt(
    `/api/groups/${encodeURIComponent(groupId)}/ansible-credential`,
    input,
  )
}

export async function deleteGroupSlot(groupId: string): Promise<void> {
  await deleteSlotAt(`/api/groups/${encodeURIComponent(groupId)}/ansible-credential`)
}

export async function getSystemSlot(systemId: string): Promise<CredentialSlot | null> {
  return getSlotAt(`/api/systems/${encodeURIComponent(systemId)}/ansible-credential`)
}

export async function putSystemSlot(
  systemId: string,
  input: CredentialUpsert,
): Promise<CredentialSlot> {
  return putSlotAt(
    `/api/systems/${encodeURIComponent(systemId)}/ansible-credential`,
    input,
  )
}

export async function deleteSystemSlot(systemId: string): Promise<void> {
  await deleteSlotAt(`/api/systems/${encodeURIComponent(systemId)}/ansible-credential`)
}

export async function getEffectiveCredential(
  systemId: string,
): Promise<EffectiveCredential | null> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/effective-credential`,
  )
  // 404 here means "no credentials resolve for this system" — the UI
  // surfaces an empty state rather than an error.
  if (resp.status === 404) return null
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as EffectiveCredential
}

// Shared helpers below — kept private so callers reach for the
// named endpoints above, which keep encodeURIComponent calls
// honest and document the exact resources in play.

async function getSlotAt(path: string): Promise<CredentialSlot | null> {
  const resp = await apiFetch(path)
  // "no slot configured at this scope" is a 404 — the UI renders
  // the empty-state editor, not an error.
  if (resp.status === 404) return null
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as CredentialSlot
}

async function putSlotAt(path: string, input: CredentialUpsert): Promise<CredentialSlot> {
  const resp = await apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as CredentialSlot
}

async function deleteSlotAt(path: string): Promise<void> {
  const resp = await apiFetch(path, { method: 'DELETE' })
  if (!resp.ok && resp.status !== 404) {
    throw new ApiError(resp.status, await parseError(resp))
  }
}
