// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

// UndecryptableSecret mirrors one row from
// GET /api/admin/secrets/undecryptable. `kind` identifies the domain
// (user_totp today; ansible / oidc to follow); `field` disambiguates
// multiple sealed columns on the same row (e.g. user_totp's `secret`
// vs in-flight `pending`).
export type UndecryptableSecret = {
  kind: string
  field: string
  targetId: string
  targetLabel: string
  keyVersion: number
}

export type UndecryptableScan = {
  count: number
  items: UndecryptableSecret[]
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

// fetchUndecryptableSecrets calls the admin scan endpoint and returns
// the affected-row list. Global Admin only; the backend gates with a
// 403 for everyone else. Callers are expected to short-circuit on
// scope before invoking, but the ApiError flows the status up for the
// rare race-with-revoke case.
export async function fetchUndecryptableSecrets(): Promise<UndecryptableScan> {
  const resp = await apiFetch('/api/admin/secrets/undecryptable')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as {
    count?: number
    items?: UndecryptableSecret[]
  }
  return { count: body.count ?? 0, items: body.items ?? [] }
}
