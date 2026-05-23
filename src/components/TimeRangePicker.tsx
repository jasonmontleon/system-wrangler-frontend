// SPDX-License-Identifier: Apache-2.0

import {
  Button,
  Flex,
  FlexItem,
  Label,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core'
import { PRESETS, useTimeRange } from '../hooks/useTimeRange'

// TimeRangePicker renders the preset toggle group + LIVE indicator +
// Reset button for the surrounding TimeRangeProvider. Step 1: presets
// only; the LIVE indicator is always green because there is no pause
// mode yet (added in step 3 of research/chart-time-controls.md).
export default function TimeRangePicker({
  defaultSeconds,
}: {
  defaultSeconds?: number
}) {
  const ctx = useTimeRange()
  if (!ctx) return null

  const selectedSeconds = ctx.range.kind === 'preset' ? ctx.range.seconds : -1
  const offDefault =
    defaultSeconds !== undefined &&
    ctx.range.kind === 'preset' &&
    ctx.range.seconds !== defaultSeconds
  const isPreset = ctx.range.kind === 'preset'
  const showReset = !isPreset || offDefault

  return (
    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
      <FlexItem>Range:</FlexItem>
      <FlexItem>
        <ToggleGroup aria-label="Time range presets">
          {PRESETS.map((p) => (
            <ToggleGroupItem
              key={p.id}
              text={p.label}
              buttonId={`time-range-${p.id}`}
              aria-label={`Show last ${p.label}`}
              isSelected={selectedSeconds === p.seconds}
              onChange={() => ctx.setPreset(p.seconds)}
            />
          ))}
        </ToggleGroup>
      </FlexItem>
      <FlexItem>
        {isPreset ? (
          <Label color="green" isCompact>
            LIVE
          </Label>
        ) : (
          <Label color="orange" isCompact>
            PAUSED
          </Label>
        )}
      </FlexItem>
      {showReset && (
        <FlexItem>
          <Button variant="link" isInline onClick={ctx.reset}>
            Reset
          </Button>
        </FlexItem>
      )}
    </Flex>
  )
}
