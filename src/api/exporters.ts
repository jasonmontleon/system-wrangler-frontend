// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type ExporterSource = 'builtin' | 'custom'

export type ExporterKind = 'node_exporter' | 'windows_exporter'

export type ExporterScrapeMode = 'localhost' | 'mtls-self' | 'mtls-byo'

export type ExporterState = 'installed' | 'running' | 'failed' | 'removed'

export type ExporterAvailability = 'available' | 'unavailable' | 'unknown'

export type ExporterRunKind = 'install' | 'status' | 'remove'

export type ExporterRunStatus =
  | 'success'
  | 'failure'
  | 'host_key_mismatch'
  | 'no_accepted_host_key'
  | 'missing_credentials'

export type ExporterDefinition = {
  id: string
  source: ExporterSource
  displayName: string
  description: string
  appliesToPkgManager: string
  exporterKind: ExporterKind
  bindPort: number
  installPlaybook: string
  statusPlaybook: string
  removePlaybook: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
}

export type ExporterDefinitionInput = {
  id: string
  displayName: string
  description: string
  appliesToPkgManager: string
  exporterKind: ExporterKind
  bindPort: number
  installPlaybook: string
  statusPlaybook: string
  removePlaybook: string
}

export type ExporterDefinitionPatch = Omit<ExporterDefinitionInput, 'id'>

export type SystemExporter = {
  exporterId: string
  source: ExporterSource
  displayName: string
  description: string
  appliesToPkgManager: string
  exporterKind: ExporterKind
  bindPort: number
  hasRemove: boolean
  availability: ExporterAvailability
  installed: boolean
  state?: ExporterState
  port?: number
  serviceName?: string
  lastStatusAt?: string
  lastInstallAt?: string
  lastReason?: string
}

export type SystemExportersResponse = {
  scrapeMode: ExporterScrapeMode
  detectedPkgManagers: string[]
  exporters: SystemExporter[]
}

export type ExporterRunResult = {
  runId: string
  exporterId: string
  kind: ExporterRunKind
  status: ExporterRunStatus
  exitCode: number
  state: ExporterState
  port?: number
  service?: string
  reason?: string
  durationMs: number
}

export type ExporterRun = {
  id: string
  systemId: string
  exporterId: string
  kind: ExporterRunKind
  startedAt: string
  finishedAt?: string
  exitCode?: number
  actorId?: string
  playbookSha?: string
  logTail?: string
}

export type ExporterConflict = {
  error: string
  conflictingRun?: string
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

export async function listExporterDefinitions(): Promise<ExporterDefinition[]> {
  const resp = await apiFetch('/api/admin/exporter-definitions')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { definitions: ExporterDefinition[] }
  return body.definitions
}

export async function createExporterDefinition(
  input: ExporterDefinitionInput,
): Promise<ExporterDefinition> {
  const resp = await apiFetch('/api/admin/exporter-definitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ExporterDefinition
}

export async function updateExporterDefinition(
  id: string,
  patch: ExporterDefinitionPatch,
): Promise<ExporterDefinition> {
  const resp = await apiFetch(
    `/api/admin/exporter-definitions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ExporterDefinition
}

export async function deleteExporterDefinition(id: string): Promise<void> {
  const resp = await apiFetch(
    `/api/admin/exporter-definitions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok && resp.status !== 404) {
    throw new ApiError(resp.status, await parseError(resp))
  }
}

export async function listSystemExporters(
  systemId: string,
): Promise<SystemExportersResponse> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/exporters`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as SystemExportersResponse
}

export async function installExporter(
  systemId: string,
  exporterId: string,
): Promise<ExporterRunResult> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/exporters/${encodeURIComponent(exporterId)}/install`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ExporterRunResult
}

export async function statusExporter(
  systemId: string,
  exporterId: string,
): Promise<ExporterRunResult> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/exporters/${encodeURIComponent(exporterId)}/status`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ExporterRunResult
}

export async function removeExporter(
  systemId: string,
  exporterId: string,
): Promise<ExporterRunResult> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/exporters/${encodeURIComponent(exporterId)}/remove`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ExporterRunResult
}

export async function setExporterScrapeMode(
  systemId: string,
  scrapeMode: ExporterScrapeMode,
): Promise<void> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/exporter-settings`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrapeMode }),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listExporterRuns(
  systemId: string,
  limit = 50,
): Promise<ExporterRun[]> {
  const url = `/api/systems/${encodeURIComponent(systemId)}/exporter-runs?limit=${limit}`
  const resp = await apiFetch(url)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { runs: ExporterRun[] }
  return body.runs
}
