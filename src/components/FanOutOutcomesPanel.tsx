// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'
import UpdaterActionResults, {
  type Props as ResultsProps,
} from './UpdaterActionResults'

// AUTO_DISMISS_MS is the idle window after which the panel
// disappears on its own. Hovering or focusing inside the panel
// pauses the timer; moving away restarts the full window so a
// partial read doesn't penalize the operator.
const AUTO_DISMISS_MS = 8000

export type Props = ResultsProps

// FanOutOutcomesPanel is the fixed-position floating wrapper that
// hosts the per-action result card. Lives outside the document
// flow so the appear / dismiss cycle doesn't shift the underlying
// table. Used by SystemsPage, GroupDetailPage, and GroupsPage.
export default function FanOutOutcomesPanel(props: Props) {
  const [hovered, setHovered] = useState(false)
  // Keep onDismiss in a ref so the timer effect doesn't have to
  // include it as a dep — callers pass inline arrows and we don't
  // want a fresh function reference each parent render to reset
  // the countdown.
  const onDismissRef = useRef(props.onDismiss)
  useEffect(() => {
    onDismissRef.current = props.onDismiss
  }, [props.onDismiss])

  useEffect(() => {
    if (props.outcomes.length === 0 || hovered) return
    const t = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [props.outcomes, hovered])

  if (props.outcomes.length === 0) return null

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHovered(false)
        }
      }}
      style={{
        position: 'fixed',
        right: '2rem',
        top: '8rem',
        width: 'min(960px, calc(100vw - 3rem))',
        maxHeight: 'calc(100vh - 9rem)',
        overflowY: 'auto',
        zIndex: 200,
        boxShadow:
          '0 0.5rem 1rem 0 rgba(3, 3, 3, 0.16), 0 0 0.375rem 0 rgba(3, 3, 3, 0.08)',
        borderRadius: '0.25rem',
      }}
    >
      <UpdaterActionResults {...props} />
    </div>
  )
}
