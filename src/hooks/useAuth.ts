// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react'
import {
  getAuthStatus,
  login as loginApi,
  logout as logoutApi,
  setupAdmin as setupApi,
  type AuthStatus,
  type AuthUser,
} from '../api/auth'

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; status: AuthStatus }

export type UseAuth = {
  state: AuthState
  setup: (username: string, password: string) => Promise<AuthUser>
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export function useAuth(): UseAuth {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const status = await getAuthStatus()
      setState({ kind: 'ready', status })
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

  const setup = useCallback(
    async (username: string, password: string) => {
      const u = await setupApi(username, password)
      await refresh()
      return u
    },
    [refresh],
  )

  const login = useCallback(
    async (username: string, password: string) => {
      const u = await loginApi(username, password)
      await refresh()
      return u
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    await logoutApi()
    await refresh()
  }, [refresh])

  return { state, setup, login, logout, refresh }
}
