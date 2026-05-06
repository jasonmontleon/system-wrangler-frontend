// SPDX-License-Identifier: AGPL-3.0-or-later

export type HostStatus = 'unprobed' | 'reachable' | 'unreachable'

export type Host = {
  id: string
  name: string
  hostname: string
  createdAt: string
  status: HostStatus
  lastSeen?: string
}

export type HostInput = {
  name: string
  hostname: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
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

export async function listHosts(): Promise<Host[]> {
  const resp = await fetch('/api/hosts')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Host[]
}

export async function createHost(input: HostInput): Promise<Host> {
  const resp = await fetch('/api/hosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Host
}

export async function deleteHost(id: string): Promise<void> {
  const resp = await fetch(`/api/hosts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
