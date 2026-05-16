// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type HostKeyState = 'pending' | 'accepted'

export type HostKey = {
  id: string
  systemId: string
  state: HostKeyState
  algorithm: string
  publicKey: string
  fingerprint: string
  firstSeenAt: string
  acceptedAt?: string
  acceptedBy?: string
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

// scanHostKeys triggers a server-side ssh-keyscan against the
// system. Each offered key is upserted into the pending slot for
// its algorithm. Returns the captured rows so the caller can
// surface them immediately (or just reload listHostKeys).
export async function scanHostKeys(systemId: string): Promise<HostKey[]> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/host-keys/scan`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { hostKeys: HostKey[] }
  return body.hostKeys
}

export async function listHostKeys(systemId: string): Promise<HostKey[]> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/host-keys`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { hostKeys: HostKey[] }
  return body.hostKeys
}

// acceptHostKey promotes a pending row to accepted. The fingerprint
// echo defeats stale-banner accepts: if the offered key changed
// between the operator loading the panel and clicking Accept, the
// backend returns 409 and the panel reloads.
export async function acceptHostKey(
  systemId: string,
  input: { algorithm: string; fingerprint: string },
): Promise<HostKey> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/host-keys/accept`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as HostKey
}

// deleteHostKey is used for both "reject a pending row" and
// "delete an accepted row before re-enrollment." The backend
// distinguishes via the audit action emitted (reject vs delete).
export async function deleteHostKey(
  systemId: string,
  keyId: string,
): Promise<void> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/host-keys/${encodeURIComponent(keyId)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok && resp.status !== 404) {
    throw new ApiError(resp.status, await parseError(resp))
  }
}
