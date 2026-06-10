// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

// Settings is the {key: value} bag returned by the backend. Every
// known key is filled in by the server (defaulted when unset), so
// callers can look a key up without nil-checking it.
export type Settings = Record<string, string>

async function parseError(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // fall through to status text
  }
  return resp.statusText || `HTTP ${resp.status}`
}

export async function listSettings(): Promise<Settings> {
  const resp = await apiFetch('/api/admin/settings')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { settings: Settings }
  return body.settings
}

// getRebootGraceSeconds reads the effective reboot-required grace
// window. Unlike listSettings, this endpoint is readable by any
// authenticated user, so the reboot-required handoff works for
// non-admin operators too.
export async function getRebootGraceSeconds(): Promise<number> {
  const resp = await apiFetch('/api/reboot-grace-seconds')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { seconds: number }
  return body.seconds
}

export async function setSetting(key: string, value: string): Promise<void> {
  const resp = await apiFetch(`/api/admin/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
