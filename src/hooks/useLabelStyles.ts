// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { listLabelStyles, type LabelStyleMap } from '../api/labelStyles'
import { useEventStream } from './useEventStream'

// useLabelStyles loads the global label-color override map on mount
// and refreshes it whenever a `systems.changed` SSE event arrives.
// Style changes piggyback on that channel — they're rare and the map
// is small, so a full re-fetch is cheaper than introducing a separate
// event type.
//
// Failure is shape-preserving: callers get the previous map (or {}
// pre-load) and a non-null `error`. The chip components fall back to
// the deterministic hash when no override is present, so a failed
// load just means "no overrides today" — visually consistent.
export function useLabelStyles(): {
  styles: LabelStyleMap
  error: string | null
  refresh: () => Promise<void>
} {
  const [styles, setStyles] = useState<LabelStyleMap>({})
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await listLabelStyles()
      setStyles(next)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEventStream(
    useCallback(
      (event) => {
        if (event.type !== 'systems.changed') return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          void refresh()
        }, 200)
      },
      [refresh],
    ),
  )
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return { styles, error, refresh }
}
