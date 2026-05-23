// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

// PromValue is one [unix-seconds, stringified-float] sample from
// Prometheus. The string form is Prometheus's wire shape — we parse
// to Number on read because JS numbers handle the float precision
// just fine for the panel use case.
export type PromSample = [number, string]

// VectorEntry is one (labels, single-sample) pair from an instant
// query.
export type VectorEntry = {
  metric: Record<string, string>
  value: PromSample
}

// MatrixEntry is one (labels, time-series) pair from a range query.
export type MatrixEntry = {
  metric: Record<string, string>
  values: PromSample[]
}

export type InstantResult = {
  resultType: 'vector' | 'matrix' | 'scalar' | 'string'
  result: VectorEntry[]
}

export type RangeResult = {
  resultType: 'matrix'
  result: MatrixEntry[]
}

export type PromResponse<T> = {
  status: 'success' | 'error'
  data?: T
  errorType?: string
  error?: string
  warnings?: string[]
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

// query runs an instant PromQL evaluation. Pass a Unix epoch seconds
// timestamp for `time` or omit to default to "now" on the server.
export async function query(
  promql: string,
  time?: number,
): Promise<VectorEntry[]> {
  const params = new URLSearchParams({ query: promql })
  if (time !== undefined) params.set('time', String(time))
  const resp = await apiFetch(`/api/metrics/query?${params.toString()}`)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as PromResponse<InstantResult>
  if (body.status !== 'success' || !body.data) {
    throw new ApiError(500, body.error ?? 'metrics query failed')
  }
  return body.data.result
}

// queryRange runs a range PromQL evaluation over [start, end] with a
// resolution of `stepSeconds`. Times are Unix epoch seconds.
export async function queryRange(
  promql: string,
  startSeconds: number,
  endSeconds: number,
  stepSeconds: number,
): Promise<MatrixEntry[]> {
  const params = new URLSearchParams({
    query: promql,
    start: String(startSeconds),
    end: String(endSeconds),
    step: String(stepSeconds),
  })
  const resp = await apiFetch(`/api/metrics/query_range?${params.toString()}`)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as PromResponse<RangeResult>
  if (body.status !== 'success' || !body.data) {
    throw new ApiError(500, body.error ?? 'metrics query_range failed')
  }
  return body.data.result
}
