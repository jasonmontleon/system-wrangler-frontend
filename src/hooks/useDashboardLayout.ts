// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  WIDGETS,
  WIDGETS_BY_ID,
  isWidgetId,
  type WidgetId,
  type WidgetParams,
} from '../dashboard/widgets'
import {
  fetchDashboardLayout,
  saveDashboardLayout,
} from '../api/dashboardLayout'

export type LayoutEntry = {
  // instanceId uniquely identifies one row in the layout. For
  // single-instance widgets it equals widgetId; for templated widgets
  // it's a generated id so multiple entries can share a widgetId with
  // different params.
  instanceId: string
  widgetId: WidgetId
  enabled: boolean
  params?: WidgetParams
}

// LAYOUT_STORAGE_KEY is the legacy localStorage key the hook used
// before server-side persistence. We still read it once at boot for a
// one-time migration, then clear it so the server is the only source
// of truth.
export const LAYOUT_STORAGE_KEY = 'sw.dashboard.layout.v1'

const SAVE_DEBOUNCE_MS = 500

function defaultLayout(): LayoutEntry[] {
  return WIDGETS.filter((w) => w.defaultEnabled).map((w) => ({
    instanceId: w.id,
    widgetId: w.id,
    enabled: w.defaultEnabled,
  }))
}

function generateInstanceId(): string {
  // crypto.randomUUID is available in modern browsers + jsdom 21+.
  // Fall back to a Math.random-derived string for very old test
  // environments — instance ids are not security-sensitive.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `inst-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

// reconcile merges a persisted layout with the current widget registry.
// Old payloads in either of two schemas are migrated:
//   - v1 `{id, enabled}` → `{instanceId: id, widgetId: id, enabled}`
//   - v2 `{id, enabled, size}` → same as v1, drop size
//   - v3 (current) `{instanceId, widgetId, enabled, params?}` passes through.
// Unknown widgetIds drop out; non-templated widgets new to the registry
// get appended with their declared defaults.
export function reconcileLayout(raw: unknown): LayoutEntry[] {
  // No persisted data → brand-new-user defaults (only the
  // default-enabled widgets). The append loop below would otherwise
  // surface opt-in singletons (compact donut, legend card) the user
  // never explicitly chose.
  if (!Array.isArray(raw)) return defaultLayout()
  const out: LayoutEntry[] = []
  const seenInstanceIds = new Set<string>()
  const seenSingletonWidgetIds = new Set<WidgetId>()
  {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      // Determine widgetId (current shape) with fallback to old `id`
      // field used by v1/v2.
      const widgetIdCandidate = (rec.widgetId ?? rec.id) as unknown
      if (!isWidgetId(widgetIdCandidate)) continue
      const widgetId = widgetIdCandidate
      const spec = WIDGETS_BY_ID.get(widgetId)
      if (!spec) continue
      const enabled = typeof rec.enabled === 'boolean' ? rec.enabled : spec.defaultEnabled
      const instanceId =
        typeof rec.instanceId === 'string' && rec.instanceId.length > 0
          ? rec.instanceId
          : widgetId
      if (seenInstanceIds.has(instanceId)) continue
      // Non-templated widgets are singletons — keep only the first
      // occurrence even across duplicates with different instanceIds.
      if (!spec.templated) {
        if (seenSingletonWidgetIds.has(widgetId)) continue
        seenSingletonWidgetIds.add(widgetId)
      }
      const params =
        rec.params && typeof rec.params === 'object'
          ? (rec.params as WidgetParams)
          : undefined
      const entry: LayoutEntry = { instanceId, widgetId, enabled }
      if (params && Object.keys(params).length > 0) entry.params = params
      out.push(entry)
      seenInstanceIds.add(instanceId)
    }
  }
  // Append any non-templated widgets that the persisted layout didn't
  // mention (e.g., a new release added one).
  for (const w of WIDGETS) {
    if (w.templated) continue
    if (seenSingletonWidgetIds.has(w.id)) continue
    out.push({ instanceId: w.id, widgetId: w.id, enabled: w.defaultEnabled })
  }
  return out
}

function readLegacyLocalStorage(): LayoutEntry[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return null
    return reconcileLayout(JSON.parse(raw))
  } catch {
    return null
  }
}

function clearLegacyLocalStorage(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY)
  } catch {
    // Private-mode storage can't remove; ignore.
  }
}

export type UseDashboardLayout = {
  layout: LayoutEntry[]
  setLayout: (next: LayoutEntry[]) => void
  reset: () => void
  status: 'loading' | 'ready' | 'error'
}

export function useDashboardLayout(): UseDashboardLayout {
  const [layout, setLayoutState] = useState<LayoutEntry[]>(() => defaultLayout())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingSave = useRef<LayoutEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const serverLayout = await fetchDashboardLayout()
        if (cancelled) return
        if (serverLayout !== null) {
          setLayoutState(reconcileLayout(serverLayout))
          clearLegacyLocalStorage()
          setStatus('ready')
          return
        }
        const legacy = readLegacyLocalStorage()
        if (legacy) {
          setLayoutState(legacy)
          try {
            await saveDashboardLayout(legacy)
            clearLegacyLocalStorage()
          } catch {
            // Migration failed; keep the legacy in-memory state and
            // try again on the next setLayout call.
          }
        }
        setStatus('ready')
      } catch {
        if (cancelled) return
        setStatus('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const flush = useCallback(() => {
    if (pendingSave.current === null) return
    const toSave = pendingSave.current
    pendingSave.current = null
    void saveDashboardLayout(toSave).catch(() => {
      // Swallow — UI already reflects the change; retry on next user action.
    })
  }, [])

  const setLayout = useCallback(
    (next: LayoutEntry[]) => {
      setLayoutState(next)
      pendingSave.current = next
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    [flush],
  )

  const reset = useCallback(() => {
    const next = defaultLayout()
    setLayoutState(next)
    pendingSave.current = next
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS)
  }, [flush])

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        flush()
      }
    }
  }, [flush])

  return useMemo(
    () => ({ layout, setLayout, reset, status }),
    [layout, setLayout, reset, status],
  )
}

export function moveEntry(
  layout: LayoutEntry[],
  index: number,
  delta: number,
): LayoutEntry[] {
  const target = index + delta
  if (target < 0 || target >= layout.length || index < 0 || index >= layout.length) {
    return layout
  }
  const next = layout.slice()
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function setEntryEnabled(
  layout: LayoutEntry[],
  instanceId: string,
  enabled: boolean,
): LayoutEntry[] {
  return layout.map((e) => (e.instanceId === instanceId ? { ...e, enabled } : e))
}

export function removeEntry(
  layout: LayoutEntry[],
  instanceId: string,
): LayoutEntry[] {
  return layout.filter((e) => e.instanceId !== instanceId)
}

// reorder moves the entry at `from` to slot `to` (an insertion index
// in 0..length). Drag-and-drop callers compute `to` from cursor Y on
// hover; the helper handles the "to shifts left after removing source"
// adjustment so callers can pass raw insertion indices.
export function reorder(
  layout: LayoutEntry[],
  from: number,
  to: number,
): LayoutEntry[] {
  if (from < 0 || from >= layout.length) return layout
  if (to < 0 || to > layout.length) return layout
  if (to === from || to === from + 1) return layout
  const next = layout.slice()
  const [item] = next.splice(from, 1)
  const adjusted = to > from ? to - 1 : to
  next.splice(adjusted, 0, item)
  return next
}

export function appendInstance(
  layout: LayoutEntry[],
  widgetId: WidgetId,
  params?: WidgetParams,
): LayoutEntry[] {
  return [
    ...layout,
    {
      instanceId: generateInstanceId(),
      widgetId,
      enabled: true,
      params,
    },
  ]
}
