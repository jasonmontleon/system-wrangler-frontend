// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'

export type ReadinessStatus = 'ready' | 'not_ready'

export type Readiness = {
  status: ReadinessStatus
  checks: Record<string, string>
}

// fetchReadiness reads /api/ready. The endpoint returns 200 + status=ready
// when every check passes and 503 + status=not_ready when any check fails;
// in both cases the body shape is the same, so we parse on either code and
// only throw on transport / parse failures.
export async function fetchReadiness(): Promise<Readiness> {
  const resp = await apiFetch('/api/ready')
  if (resp.status !== 200 && resp.status !== 503) {
    throw new Error(`readiness: HTTP ${resp.status}`)
  }
  return (await resp.json()) as Readiness
}
