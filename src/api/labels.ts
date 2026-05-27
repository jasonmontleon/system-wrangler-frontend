// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

// Label is one (key, value) pair attached to a system. value is
// nullable: null means "bare tag" (existence-only match in selectors),
// "" is a legal equality target distinct from null.
export type Label = {
  key: string
  value: string | null
}

// LabelKeySummary is one entry from GET /api/labels — a key plus its
// per-value cardinalities. The bare-tag bucket appears as a
// LabelValueSummary with value: null.
export type LabelKeySummary = {
  key: string
  count: number
  values: LabelValueSummary[]
}

export type LabelValueSummary = {
  value: string | null
  count: number
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

// listLabelSummary returns distinct keys with per-value cardinalities,
// useful for filter-bar autocomplete and a future labels overview UI.
export async function listLabelSummary(): Promise<LabelKeySummary[]> {
  const resp = await apiFetch('/api/labels')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as LabelKeySummary[]
}

// listSystemLabels returns the labels attached to a single system.
// The Systems list response already inlines `labels` per row, so this
// is mostly for the detail page's "edit labels" panel.
export async function listSystemLabels(systemId: string): Promise<Label[]> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/labels`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Label[]
}

// setSystemLabel creates or updates one (key, value) pair on the
// system. Pass value: null to set a bare tag; "" is a legal empty-
// string value (distinct from null).
export async function setSystemLabel(
  systemId: string,
  key: string,
  value: string | null,
): Promise<Label> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/labels/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Label
}

// deleteSystemLabel removes a label key from a system. 404 surfaces as
// ApiError so callers can treat already-gone differently from
// permission-denied.
export async function deleteSystemLabel(
  systemId: string,
  key: string,
): Promise<void> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/labels/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
