// SPDX-License-Identifier: Apache-2.0

import { Label, LabelGroup } from '@patternfly/react-core'
import type { Label as LabelType } from '../api/labels'
import type { LabelStyleMap } from '../api/labelStyles'
import type { SystemStatus } from '../api/systems'
import { colorFor } from '../lib/labelColors'
import { STATUS_LABELS } from './systemsTableHelpers'

// SystemLabelsCell renders the cell shared by the Systems table and
// any other place that lists systems. Status is a System Wrangler
// system-set label expressed as a pinned, severity-colored chip; the
// user-assigned labels follow as outline chips. Format mirrors the
// k8s-subset selector grammar: bare tags render as the key alone,
// dimensional labels render as `key=value`. Empty-string values
// render as `key=` to match the equality form the selector parser
// accepts.
//
// numLabels caps the visible chips so high-density rows don't blow
// out the row height; PatternFly LabelGroup supplies the "+N more"
// affordance and expand/collapse interaction for free.
export type SystemLabelsCellProps = {
  status: SystemStatus
  labels: LabelType[] | undefined
  numLabels?: number
  // styleOverrides is the global label-color override map (from
  // /api/label-styles). When a label's key is present, its chip
  // renders in that color; missing keys fall back to a deterministic
  // hash of the key so the same label key gets a stable color
  // everywhere even without an explicit override.
  styleOverrides?: LabelStyleMap
  // onLabelClick fires when any chip is clicked. Wired by the page
  // to append the chip's requirement to the selector filter. Status
  // chips emit a synthetic `{key:"status", value:<status>}` label so
  // the same handler can route both to the selector input; the SPA
  // applies status filtering client-side because status isn't in
  // the system_labels table.
  onLabelClick?: (label: LabelType) => void
}

export default function SystemLabelsCell({
  status,
  labels,
  numLabels = 4,
  styleOverrides,
  onLabelClick,
}: SystemLabelsCellProps) {
  const statusCfg = STATUS_LABELS[status] ?? STATUS_LABELS.unprobed
  return (
    <LabelGroup
      numLabels={numLabels}
      isCompact
      aria-label="Labels"
      expandedText="Show fewer"
      collapsedText="${remaining} more"
    >
      <Label
        key="__status"
        color={statusCfg.color}
        isCompact
        data-testid="label-status"
        onClick={
          onLabelClick
            ? () => onLabelClick({ key: 'status', value: status })
            : undefined
        }
      >
        {statusCfg.text}
      </Label>
      {(labels ?? []).map((l) => (
        <Label
          key={l.key}
          color={colorFor(l.key, styleOverrides)}
          isCompact
          data-testid="label-user"
          onClick={onLabelClick ? () => onLabelClick(l) : undefined}
        >
          {formatLabel(l)}
        </Label>
      ))}
    </LabelGroup>
  )
}

// formatLabel renders one user label as text. Mirrors the selector
// grammar so chip text round-trips into a `?labels=` query when the
// filter bar lands.
function formatLabel(l: LabelType): string {
  return l.value === null ? l.key : `${l.key}=${l.value}`
}
