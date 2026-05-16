// SPDX-License-Identifier: Apache-2.0

import {
  applyUpdater,
  checkUpdater,
  listSystemUpdaters,
  type UpdaterRunResult,
} from '../api/updaters'
import { ApiError } from '../api/systems'

// FanOutOutcome captures how a single system's check/apply pass
// went. `attempted` is the count of enabled+detected updaters;
// `failures` carries the per-updater error messages so the SPA can
// surface them without re-fetching audit. The two together let the
// caller render "Ran check on N updaters on web-1; M failed" plus a
// drill-down for the failed ones.
export type FanOutOutcome = {
  systemId: string
  systemName: string
  action: 'check' | 'apply'
  attempted: number
  // skipped is true when the call shorted out before any per-updater
  // POST fired — typically "no enabled updaters" or a GET failure
  // surfaced as a skipped result rather than as N×0 failures.
  skipped: boolean
  skipReason?: string
  results: Array<{
    updaterId: string
    displayName: string
    ok: boolean
    affectedCount?: number
    error?: string
  }>
}

// fanOutOnSystem fetches the per-system updater list, filters to
// enabled+detected, and POSTs the named action against each. The
// per-system advisory lock on the backend already serializes
// concurrent runs against the same host, so the sequential loop is
// a deliberate choice — the next request can't progress until the
// previous one's lock drops anyway.
export async function fanOutOnSystem(
  systemId: string,
  systemName: string,
  action: 'check' | 'apply',
): Promise<FanOutOutcome> {
  const outcome: FanOutOutcome = {
    systemId,
    systemName,
    action,
    attempted: 0,
    skipped: false,
    results: [],
  }
  let updaters
  try {
    updaters = await listSystemUpdaters(systemId)
  } catch (err) {
    outcome.skipped = true
    outcome.skipReason = extractError(err)
    return outcome
  }
  const targets = updaters.filter((u) => u.installed && u.enabled)
  if (targets.length === 0) {
    outcome.skipped = true
    outcome.skipReason =
      'No enabled updaters on this system. Inspect the system or enable an updater on its detail page first.'
    return outcome
  }
  outcome.attempted = targets.length
  const runner = action === 'apply' ? applyUpdater : checkUpdater
  for (const u of targets) {
    try {
      const res: UpdaterRunResult = await runner(systemId, u.updaterId)
      outcome.results.push({
        updaterId: u.updaterId,
        displayName: u.displayName,
        ok: res.status === 'success',
        affectedCount: res.affectedCount,
        error:
          res.status === 'success'
            ? undefined
            : res.reason || `${res.status} (exit ${res.exitCode})`,
      })
    } catch (err) {
      outcome.results.push({
        updaterId: u.updaterId,
        displayName: u.displayName,
        ok: false,
        error: extractError(err),
      })
    }
  }
  return outcome
}

function extractError(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return 'Another inspect/check/apply is running for this system. Wait for it to finish and retry.'
  }
  return err instanceof Error ? err.message : String(err)
}
