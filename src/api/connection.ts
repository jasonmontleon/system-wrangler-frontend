// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type ConnectionStatus =
  | 'success'
  | 'failure'
  | 'host_key_mismatch'
  | 'no_accepted_host_key'
  | 'missing_credentials'

export type ConnectionTestResult = {
  status: ConnectionStatus
  reason: string
  exitCode: number
  durationMs: number
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

// testConnection runs `ansible <host> -m ping` against the system
// and reports the verdict. End-to-end check that credentials, host
// keys, and the network path all work.
export async function testConnection(
  systemId: string,
): Promise<ConnectionTestResult> {
  const resp = await apiFetch(
    `/api/systems/${encodeURIComponent(systemId)}/test-connection`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ConnectionTestResult
}
