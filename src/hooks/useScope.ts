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
export function useScope(): UseScope {
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
    void refresh()
  }, [refresh])
  return { state, refresh }
}

// Convenience helpers for the common UI gates. They tolerate the
// loading / error states by returning false (fail-closed for UI).

export function isGlobalAdmin(state: ScopeState): boolean {
  return state.kind === 'ready' && state.scope.global === 'admin'
}

export function roleOnGroup(state: ScopeState, groupId: string): Role | '' {
  if (state.kind !== 'ready') return ''
  return state.scope.groups[groupId] ?? ''
}

export function canAdminGroup(state: ScopeState, groupId: string): boolean {
  if (state.kind !== 'ready') return false
  return state.scope.global === 'admin' || state.scope.groups[groupId] === 'admin'
}
