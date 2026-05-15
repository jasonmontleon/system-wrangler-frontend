// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type BackupDownload = {
  blob: Blob
  filename: string
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

// requestBackup triggers VACUUM INTO server-side and streams the
// resulting .db file back to the browser. The filename is read from
// the server-supplied Content-Disposition header (the backend formats
// it as system-wrangler-<UTC timestamp>.db) and falls back to a
// client-side default if the header is missing or malformed.
export async function requestBackup(): Promise<BackupDownload> {
  const resp = await apiFetch('/api/admin/backup', { method: 'POST' })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const blob = await resp.blob()
  const filename = parseFilename(resp.headers.get('Content-Disposition'))
  return { blob, filename }
}

const FILENAME_FALLBACK = 'system-wrangler-backup.db'

// parseFilename extracts the filename from a Content-Disposition
// header value. Handles the quoted form the backend emits
// (`attachment; filename="system-wrangler-...db"`); falls back to a
// generic name on any malformed input rather than throwing so the
// download still proceeds.
export function parseFilename(header: string | null): string {
  if (!header) return FILENAME_FALLBACK
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(header)
  if (!match) return FILENAME_FALLBACK
  const name = match[1].trim()
  return name || FILENAME_FALLBACK
}
