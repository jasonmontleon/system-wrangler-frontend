// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'

export type BuildInfo = {
  backend: string
  frontend: string
  buildDate: string
}

export async function fetchBuildInfo(): Promise<BuildInfo> {
  const resp = await apiFetch('/api/build-info')
  if (!resp.ok) {
    throw new Error(`build-info: HTTP ${resp.status}`)
  }
  return (await resp.json()) as BuildInfo
}
