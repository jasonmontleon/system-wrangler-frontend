// SPDX-License-Identifier: Apache-2.0

import { Button, Label, Stack, StackItem } from '@patternfly/react-core'
import { ALL_LABEL_COLORS, type LabelColor } from '../api/labelStyles'

type Props = {
  // labelText is the chip text (e.g. "env=prod") so the user sees
  // which label they're recoloring.
  labelText: string
  // currentColor is the color the chip is using right now — either
  // an explicit override or the hash-derived default. Used to mark
  // the active swatch.
  currentColor: LabelColor
  // hasOverride is true when this key has a persisted style row.
  // Drives whether the "Auto" button is enabled (no point clearing
  // an override that isn't there).
  hasOverride: boolean
  isBusy: boolean
  onSelect: (color: LabelColor) => void
  onReset: () => void
  onCancel: () => void
}

// LabelColorPicker is the small panel that drops in below the chip
// group on SystemLabelsCard when a Global Admin clicks a chip. It
// shows the 9 PatternFly Label colors as miniature labels — click
// one to persist that color for the chip's key fleet-wide; click
// "Auto" to clear the override and fall back to the deterministic
// hash. Color choices are global (key-scoped), so changing the color
// of one chip changes every chip with the same key on every page.
export default function LabelColorPicker({
  labelText,
  currentColor,
  hasOverride,
  isBusy,
  onSelect,
  onReset,
  onCancel,
}: Props) {
  return (
    <Stack hasGutter>
      <StackItem>
        <strong>Color for </strong>
        <code>{labelText}</code>
      </StackItem>
      <StackItem>
        <div
          role="radiogroup"
          aria-label="Label color"
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
        >
          {ALL_LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === currentColor}
              aria-label={`Set color to ${c}`}
              disabled={isBusy}
              onClick={() => onSelect(c)}
              style={{
                border:
                  c === currentColor
                    ? '2px solid var(--pf-t--global--border--color--default)'
                    : '2px solid transparent',
                background: 'transparent',
                padding: 2,
                cursor: isBusy ? 'wait' : 'pointer',
              }}
            >
              <Label color={c} isCompact>
                {c}
              </Label>
            </button>
          ))}
        </div>
      </StackItem>
      <StackItem>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button
            variant="secondary"
            isDisabled={isBusy || !hasOverride}
            onClick={onReset}
          >
            Auto (hash)
          </Button>
          <Button variant="link" isDisabled={isBusy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </StackItem>
    </Stack>
  )
}
