// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type TargetKind = 'global' | 'group' | 'systems' | 'selector'
export type RunStatus = 'running' | 'success' | 'partial' | 'failed'

export type Schedule = {
  id: string
  name: string
  cronExpr: string
  timezone: string
  runCheck: boolean
  runApply: boolean
  rebootAfterApply: boolean
  targetKind: TargetKind
  targetValue: string
  enabled: boolean
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: RunStatus
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type ScheduleInput = {
  name: string
  cronExpr: string
  timezone?: string
  runCheck: boolean
  runApply: boolean
  rebootAfterApply: boolean
  targetKind: TargetKind
  targetValue: string
  enabled: boolean
}

export type ScheduleRun = {
  id: string
  scheduleId: string
  startedAt: string
  finishedAt?: string
  status: RunStatus
  targetsAttempted: number
  targetsSucceeded: number
  targetsFailed: number
  message?: string
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

export async function listSchedules(): Promise<Schedule[]> {
  const resp = await apiFetch('/api/schedules')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Schedule[]
}

export async function getSchedule(id: string): Promise<Schedule> {
  const resp = await apiFetch(`/api/schedules/${encodeURIComponent(id)}`)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Schedule
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  const resp = await apiFetch('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Schedule
}

export async function updateSchedule(
  id: string,
  input: ScheduleInput,
): Promise<Schedule> {
  const resp = await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Schedule
}

export async function deleteSchedule(id: string): Promise<void> {
  const resp = await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listScheduleRuns(
  id: string,
  limit?: number,
): Promise<ScheduleRun[]> {
  const path = limit
    ? `/api/schedules/${encodeURIComponent(id)}/runs?limit=${limit}`
    : `/api/schedules/${encodeURIComponent(id)}/runs`
  const resp = await apiFetch(path)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ScheduleRun[]
}

export async function runScheduleNow(id: string): Promise<void> {
  const resp = await apiFetch(
    `/api/schedules/${encodeURIComponent(id)}/run-now`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
