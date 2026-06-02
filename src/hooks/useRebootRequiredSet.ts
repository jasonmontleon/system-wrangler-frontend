// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { queryRebootRequiredSet } from '../util/rebootSignal'

// REBOOT_POLL_INTERVAL_MS matches the metric-refresh cadence the
// Dashboard and Systems overview already use. The sw_reboot_required
// gauge is re-emitted by the textfile collector roughly every minute,
// so a 30s poll clears the chip within a cycle of a system rebooting.
const REBOOT_POLL_INTERVAL_MS = 30_000

// useRebootRequiredSet keeps the set of system ids reporting
// sw_reboot_required > 0 fresh on its own timer, decoupled from the
// SSE-driven systems refresh. A plain reboot drops the gauge but emits
// no systems.changed event, so without an independent poll the chip
// would persist until the page was manually reloaded. Prometheus
// errors are swallowed — the last good set is kept and the column-only
// signal still drives the chip.
export function useRebootRequiredSet(): Set<string> {
  const [set, setSet] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const next = await queryRebootRequiredSet()
        if (!cancelled) setSet(next)
      } catch {
        // intentionally ignored — keep the last good set
      }
    }
    void tick()
    const handle = window.setInterval(() => {
      void tick()
    }, REBOOT_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])
  return set
}
