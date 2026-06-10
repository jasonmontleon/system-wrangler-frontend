// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { getRebootGraceSeconds } from '../api/settings'

// DEFAULT_REBOOT_GRACE_MS mirrors the backend DefaultRebootGraceSeconds
// (120s). Used until the configured value loads, and kept as the
// fallback if the fetch fails so the reboot-required handoff still
// works for every operator.
export const DEFAULT_REBOOT_GRACE_MS = 120_000

// useRebootGraceMs fetches the instance's reboot_grace_seconds setting
// once on mount and returns it in milliseconds. The value rarely
// changes, so a single fetch is enough; on error the backend default is
// retained. This drives how long needsReboot trusts the apply-stamped
// column before the sw_reboot_required metric takes over.
export function useRebootGraceMs(): number {
  const [ms, setMs] = useState(DEFAULT_REBOOT_GRACE_MS)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const seconds = await getRebootGraceSeconds()
        if (!cancelled && Number.isFinite(seconds) && seconds > 0) {
          setMs(seconds * 1000)
        }
      } catch {
        // keep the default
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return ms
}
