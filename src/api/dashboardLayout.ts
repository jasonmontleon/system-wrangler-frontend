// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'

// LayoutPayload is what the frontend hands to the server: any
// JSON-serialisable value. The server treats it as opaque storage and
// never inspects the shape — `useDashboardLayout` owns the schema.
export type LayoutPayload = unknown

type LayoutResponse = { layout?: LayoutPayload }

export async function fetchDashboardLayout(): Promise<LayoutPayload | null> {
  const resp = await apiFetch('/api/dashboard/layout')
  if (!resp.ok) {
    throw new Error(`dashboard layout: HTTP ${resp.status}`)
  }
  const body = (await resp.json()) as LayoutResponse
  return body.layout ?? null
}

export async function saveDashboardLayout(layout: LayoutPayload): Promise<void> {
  const resp = await apiFetch('/api/dashboard/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout }),
  })
  if (!resp.ok) {
    throw new Error(`dashboard layout save: HTTP ${resp.status}`)
  }
}
