// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

// LabelColor is the closed set the backend accepts on PUT. Mirrors
// PatternFly v6 Label's `color` prop so the value can be handed
// straight into <Label color={...}>.
export type LabelColor =
  | 'blue'
  | 'teal'
  | 'green'
  | 'orange'
  | 'purple'
  | 'red'
  | 'orangered'
  | 'grey'
  | 'yellow'

// ALL_LABEL_COLORS is the deterministic order the auto-color hash
// indexes into. Don't reorder casually — every existing label's
// auto-assigned color would shift.
export const ALL_LABEL_COLORS: readonly LabelColor[] = [
  'blue',
  'teal',
  'green',
  'orange',
  'purple',
  'red',
  'orangered',
  'grey',
  'yellow',
]

// LabelStyleMap is the response shape of GET /api/label-styles —
// label key → user-chosen color. Keys not present in the map fall
// back to the deterministic hash in src/lib/labelColors.ts.
export type LabelStyleMap = Record<string, LabelColor>

async function parseError(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // fall through to status text
  }
  return resp.statusText || `HTTP ${resp.status}`
}

// listLabelStyles fetches the override map. Cheap to call — the SPA
// holds it in a top-level hook and updates over SSE.
export async function listLabelStyles(): Promise<LabelStyleMap> {
  const resp = await apiFetch('/api/label-styles')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as LabelStyleMap
}

// setLabelStyle persists `key → color` globally. Global Admin only;
// callers without permission get an ApiError with status 403.
export async function setLabelStyle(
  key: string,
  color: LabelColor,
): Promise<{ key: string; color: LabelColor }> {
  const resp = await apiFetch(
    `/api/label-styles/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as { key: string; color: LabelColor }
}

// deleteLabelStyle drops the override for `key`, letting the chip
// fall back to the deterministic hash color.
export async function deleteLabelStyle(key: string): Promise<void> {
  const resp = await apiFetch(
    `/api/label-styles/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
