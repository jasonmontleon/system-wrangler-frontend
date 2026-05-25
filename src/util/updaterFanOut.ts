// SPDX-License-Identifier: Apache-2.0

import {
  applyUpdater,
  checkUpdater,
  listSystemUpdaters,
  type SystemUpdater,
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
  const enabled = updaters.filter((u) => u.installed && u.enabled)
  if (enabled.length === 0) {
    outcome.skipped = true
    outcome.skipReason =
      'No enabled updaters on this system. Inspect the system or enable an updater on its detail page first.'
    return outcome
  }
  const targets = action === 'apply' ? enabled.filter((u) => !u.checkOnly) : enabled
  if (targets.length === 0) {
    outcome.skipped = true
    outcome.skipReason =
      'Only check-only updaters are enabled on this system; they surface pending changes but cannot be applied.'
    return outcome
  }
  outcome.attempted = targets.length
  const runner = action === 'apply' ? applyUpdater : checkUpdater
  for (const u of targets) {
    try {
      const res: UpdaterRunResult = await runner(systemId, u.updaterId)
      const ok = res.status === 'success'
      outcome.results.push({
        updaterId: u.updaterId,
        displayName: u.displayName,
        ok,
        affectedCount: res.affectedCount,
        error: ok
          ? undefined
          : res.reason || `${res.status} (exit ${res.exitCode})`,
      })
      // Auto-Check after a successful Apply so Updates Available
      // reflects the post-update state. The stats query reads
      // check runs only, so Apply alone doesn't move the pending
      // count. Failures here are swallowed — the apply itself
      // already succeeded; an inability to refresh the count is
      // a cosmetic loss, not a reason to flip the row to red.
      if (ok && action === 'apply') {
        try {
          await checkUpdater(systemId, u.updaterId)
        } catch {
          // intentionally ignored
        }
      }
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

// TargetedSelection is one operator-picked (updater, package) pair.
// Different updaters may both surface the same package name (e.g. a
// Mac with brew and mas both pending `openssl`); the operator picks
// which one fires by selecting that updater's row in the picker.
export type TargetedSelection = {
  updaterId: string
  packageName: string
}

// fanOutTargetedSelectionsOnSystem fans out a cross-system "update
// just these (updater, package) pairs" call against a single system.
// Selections are grouped by updaterId so each updater fires once
// with its package subset; updaters not installed / not enabled /
// check-only are dropped and updaters whose pendingPackages no
// longer include the chosen name are dropped (stale data check).
// Systems with no remaining work are reported as skipped.
export async function fanOutTargetedSelectionsOnSystem(
  systemId: string,
  systemName: string,
  selections: TargetedSelection[],
): Promise<FanOutOutcome> {
  const outcome: FanOutOutcome = {
    systemId,
    systemName,
    action: 'apply',
    attempted: 0,
    skipped: false,
    results: [],
  }
  if (selections.length === 0) {
    outcome.skipped = true
    outcome.skipReason = 'No packages selected.'
    return outcome
  }
  let updaters: SystemUpdater[]
  try {
    updaters = await listSystemUpdaters(systemId)
  } catch (err) {
    outcome.skipped = true
    outcome.skipReason = extractError(err)
    return outcome
  }
  const byUpdater = new Map<string, Set<string>>()
  for (const sel of selections) {
    let set = byUpdater.get(sel.updaterId)
    if (!set) {
      set = new Set()
      byUpdater.set(sel.updaterId, set)
    }
    set.add(sel.packageName)
  }
  const matches: { updater: SystemUpdater; subset: string[] }[] = []
  for (const u of updaters) {
    if (!u.installed || !u.enabled || u.checkOnly) continue
    const wanted = byUpdater.get(u.updaterId)
    if (!wanted) continue
    const subset: string[] = []
    for (const p of u.pendingPackages) {
      if (wanted.has(p.name)) subset.push(p.name)
    }
    if (subset.length === 0) continue
    matches.push({ updater: u, subset })
  }
  if (matches.length === 0) {
    outcome.skipped = true
    outcome.skipReason =
      'None of the selected packages are pending on this system.'
    return outcome
  }
  outcome.attempted = matches.length
  for (const { updater: u, subset } of matches) {
    try {
      const res: UpdaterRunResult = await applyUpdater(
        systemId,
        u.updaterId,
        subset,
      )
      const ok = res.status === 'success'
      outcome.results.push({
        updaterId: u.updaterId,
        displayName: u.displayName,
        ok,
        affectedCount: res.affectedCount,
        error: ok
          ? undefined
          : res.reason || `${res.status} (exit ${res.exitCode})`,
      })
      if (ok) {
        try {
          await checkUpdater(systemId, u.updaterId)
        } catch {
          // intentionally ignored — refresh is best-effort
        }
      }
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
