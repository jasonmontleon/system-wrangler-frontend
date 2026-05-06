// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'cw-theme'
const DARK_CLASS = 'pf-v6-theme-dark'

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    // localStorage may be unavailable (private mode); fall through to default.
  }
  return 'dark'
}

function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'dark') root.classList.add(DARK_CLASS)
  else root.classList.remove(DARK_CLASS)
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readStored)

  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore — toggle still works in-session even if persistence fails
    }
  }, [theme])

  return [theme, setTheme]
}
