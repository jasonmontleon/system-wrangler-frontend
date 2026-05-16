// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { fetchMyScope, type Role, type Scope } from '../api/roles'

export type ScopeState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; scope: Scope }

export type UseScope = {
  state: ScopeState
  refresh: () => Promise<void>
}

// useScope fetches the caller's RBAC scope summary on mount. The
// result is used by UI gates: only Global Admin shows the
// unrestricted picker on the Group Roles tab; non-admins see the
// table read-only. Backend enforcement is still the source of
// truth; this is purely cosmetic.
//
// `userKey` is the authenticated user's identifier (typically
// user.id) or `null` when no one is authenticated. Passing it
// lets the hook refetch whenever the active session changes so
// stale scope from a prior login can't leak into the next one —
// the canonical trigger is the sidebar nav: log out as Global
// Admin, log back in as a non-admin, the "Backup" entry would
// otherwise linger until the page is refreshed. Callers that
// only mount inside an authenticated tree (e.g. a route page)
// can omit the argument and get the legacy "fetch once" behavior.
export function useScope(userKey?: string | null): UseScope {
  const [state, setState] = useState<ScopeState>({ kind: 'loading' })
  const refresh = useCallback(async () => {
    try {
      const scope = await fetchMyScope()
      setState({ kind: 'ready', scope })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])
  useEffect(() => {
    if (userKey === undefined) {
      // Caller passed nothing (e.g. a page that mounts inside an
      // authenticated tree). Fetch once on mount; no further
      // re-runs since the dependency stays stable.
      void refresh()
      return
    }
    if (userKey === null) {
      // Caller explicitly says "no one is signed in." Reset to
      // loading so any previously-resolved scope can't surface to
      // gates that skipped the auth check, and skip the fetch —
      // /api/me/scope would just 401.
      setState({ kind: 'loading' })
      return
    }
    void refresh()
  }, [userKey, refresh])
  return { state, refresh }
}

// Convenience helpers for the common UI gates. They tolerate the
// loading / error states by returning false (fail-closed for UI).

export function isGlobalAdmin(state: ScopeState): boolean {
  return state.kind === 'ready' && state.scope.global === 'admin'
}

// isGlobalOperator returns true for callers who can act on any
// group — Global Admin OR Global Operator. Used by the updater
// surfaces, where "operator on the group" is the unit of access
// and a global role short-circuits the per-group lookup.
export function isGlobalOperator(state: ScopeState): boolean {
  if (state.kind !== 'ready') return false
  return state.scope.global === 'admin' || state.scope.global === 'operator'
}

export function roleOnGroup(state: ScopeState, groupId: string): Role | '' {
  if (state.kind !== 'ready') return ''
  return state.scope.groups[groupId] ?? ''
}

export function canAdminGroup(state: ScopeState, groupId: string): boolean {
  if (state.kind !== 'ready') return false
  return state.scope.global === 'admin' || state.scope.groups[groupId] === 'admin'
}
