// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const DARK_CLASS = 'pf-v6-theme-dark'
const DEFAULT_THEME: Theme = 'dark'

export function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.classList.add(DARK_CLASS)
  else root.classList.remove(DARK_CLASS)
}

// useTheme reflects the authenticated user's stored preference. When there
// is no logged-in user (login screen, setup screen, error state) it falls
// back to the project default — explicitly NOT the previous user's
// preference, so signing out always returns to dark.
export function useTheme(serverTheme?: string): [Theme, (next: Theme) => void] {
  const initial: Theme =
    serverTheme === 'light' || serverTheme === 'dark' ? serverTheme : DEFAULT_THEME
  const [theme, setTheme] = useState<Theme>(initial)

  useEffect(() => {
    if (serverTheme === 'light' || serverTheme === 'dark') {
      setTheme(serverTheme)
    } else {
      setTheme(DEFAULT_THEME)
    }
  }, [serverTheme])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return [theme, setTheme]
}
