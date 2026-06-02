// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type TargetKind = 'global' | 'group' | 'systems' | 'selector'
export type ConditionKind = 'metric' | 'promql' | 'unreachable'
export type Comparator = 'gt' | 'gte' | 'lt' | 'lte'
export type Severity = 'info' | 'warning' | 'critical'
export type AlertMetric =
  | 'mem_used_pct'
  | 'fs_used_pct'
  | 'cpu_busy_pct'
  | 'swap_used_pct'
  | 'load1'
export type AlertState = 'pending' | 'firing'

export type AlertRule = {
  id: string
  name: string
  description?: string
  conditionKind: ConditionKind
  metric?: AlertMetric
  expr?: string
  comparator?: Comparator
  threshold: number
  forSeconds: number
  severity: Severity
  targetKind: TargetKind
  targetValue: string
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type AlertRuleInput = {
  name: string
  description?: string
  conditionKind: ConditionKind
  metric?: AlertMetric
  expr?: string
  comparator?: Comparator
  threshold: number
  forSeconds: number
  severity: Severity
  targetKind: TargetKind
  targetValue: string
  enabled: boolean
}

export type AlertCatalogEntry = {
  metric: AlertMetric
  label: string
  unit: string
}

export type ActiveAlert = {
  ruleId: string
  systemId: string
  state: AlertState
  value: number
  firstBreachAt: string
  firedAt?: string
  lastEvalAt: string
  ruleName: string
  severity: Severity
  conditionKind: ConditionKind
  metric?: AlertMetric
  comparator?: Comparator
  threshold: number
  systemName?: string
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

export async function listAlertRules(): Promise<AlertRule[]> {
  const resp = await apiFetch('/api/alerts')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AlertRule[]
}

export async function createAlertRule(input: AlertRuleInput): Promise<AlertRule> {
  const resp = await apiFetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AlertRule
}

export async function updateAlertRule(
  id: string,
  input: AlertRuleInput,
): Promise<AlertRule> {
  const resp = await apiFetch(`/api/alerts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AlertRule
}

export async function deleteAlertRule(id: string): Promise<void> {
  const resp = await apiFetch(`/api/alerts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listActiveAlerts(): Promise<ActiveAlert[]> {
  const resp = await apiFetch('/api/alerts/active')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ActiveAlert[]
}

export async function listAlertCatalog(): Promise<AlertCatalogEntry[]> {
  const resp = await apiFetch('/api/alerts/catalog')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AlertCatalogEntry[]
}
