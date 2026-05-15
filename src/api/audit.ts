// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type AuditActorKind = 'user' | 'system' | 'unauthenticated'

export type AuditOutcome = 'success' | 'failure' | 'denied'

export type AuditRecord = {
  id: string
  occurredAt: string
  actorKind: AuditActorKind
  actorId?: string
  actorLabel?: string
  action: string
  targetKind?: string
  targetId?: string
  targetLabel?: string
  outcome: AuditOutcome
  detail?: Record<string, unknown>
  requestIp?: string
  requestId?: string
}

export type AuditCursor = {
  afterMs: number
  afterId: string
}

export type AuditListResponse = {
  records: AuditRecord[]
  next?: AuditCursor
}

export type AuditListParams = {
  limit?: number
  // cursor returned by a previous page; pass both fields together
  after?: AuditCursor
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

export async function listAudit(
  params: AuditListParams = {},
): Promise<AuditListResponse> {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set('limit', String(params.limit))
  if (params.after) {
    qs.set('after_ms', String(params.after.afterMs))
    qs.set('after_id', params.after.afterId)
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const resp = await apiFetch(`/api/admin/audit${suffix}`)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AuditListResponse
}
