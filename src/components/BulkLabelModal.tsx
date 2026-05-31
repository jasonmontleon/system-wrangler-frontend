// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import {
  Button,
  Content,
  Form,
  FormGroup,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core'
import { ALL_LABEL_COLORS, type LabelColor } from '../api/labelStyles'

type Mode = 'add' | 'remove'

// ColorChoice is the optional second action a Global Admin can take
// when bulk-adding a label: pick a fleet-wide color for the key, or
// reset the override so the chip falls back to the deterministic
// hash. null means "don't change the style" — the per-key override
// (or its absence) is left untouched.
export type ColorChoice = LabelColor | 'auto' | null

type Props = {
  isOpen: boolean
  mode: Mode
  count: number
  // canManageStyles, when true, shows the color picker section in
  // the add flow. Wired to Global Admin on the calling page.
  canManageStyles?: boolean
  onSubmit: (
    key: string,
    value: string | null,
    color: ColorChoice,
  ) => void | Promise<void>
  onClose: () => void
}

// BulkLabelModal captures a single label line — `env=prod` for a k=v
// label or just `oncall` for a bare tag — and hands the parsed
// (key, value) pair to the caller. Reused for both add and remove
// flows; remove uses only the key half. Client-side validation is
// minimal (non-empty key, value parses out of an `=` split if
// present); the per-system PUT/DELETE that follows surfaces the
// real backend errors.
export default function BulkLabelModal({
  isOpen,
  mode,
  count,
  canManageStyles = false,
  onSubmit,
  onClose,
}: Props) {
  const [input, setInput] = useState('')
  const [colorChoice, setColorChoice] = useState<ColorChoice>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setInput('')
      setColorChoice(null)
      setError(null)
      setBusy(false)
    }
  }, [isOpen])

  const submit = async () => {
    const text = input.trim()
    if (text === '') {
      setError('Label is required.')
      return
    }
    const eq = text.indexOf('=')
    const key = (eq === -1 ? text : text.slice(0, eq)).trim()
    if (key === '') {
      setError('Key is required.')
      return
    }
    const value = mode === 'remove' ? null : eq === -1 ? null : text.slice(eq + 1)
    setError(null)
    setBusy(true)
    try {
      // Color is only honoured on add — removing a label doesn't
      // change the global style row.
      await onSubmit(key, value, mode === 'add' ? colorChoice : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
      return
    }
    setBusy(false)
  }

  const title = mode === 'add' ? 'Add label to selected systems' : 'Remove label from selected systems'
  const verb = mode === 'add' ? 'Add' : 'Remove'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="small"
      aria-label={title}
    >
      <ModalHeader title={title} />
      <ModalBody>
        <Form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <FormGroup
            label={mode === 'add' ? 'Label' : 'Label key'}
            fieldId="bulk-label-input"
          >
            <TextInput
              id="bulk-label-input"
              aria-label="Label"
              placeholder={
                mode === 'add'
                  ? 'env=prod or oncall for a bare tag'
                  : 'env or env=prod'
              }
              value={input}
              isDisabled={busy}
              onChange={(_, v) => setInput(v)}
              autoFocus
            />
          </FormGroup>
          {mode === 'add' && (
            <Content component="small">
              Applies to <strong>{count}</strong> selected{' '}
              {count === 1 ? 'system' : 'systems'}. Keys follow the
              k8s subset: <code>[a-zA-Z0-9._-]</code> with an optional{' '}
              <code>prefix/</code> segment.{' '}
              <code>system-wrangler.io/</code> is reserved.
            </Content>
          )}
          {mode === 'remove' && (
            <Content component="small">
              Removes the label key from <strong>{count}</strong>{' '}
              selected {count === 1 ? 'system' : 'systems'}. Systems
              that don&apos;t carry the key are reported as skipped.
              An <code>=value</code> suffix on the input is ignored —
              removal is by key.
            </Content>
          )}
          {mode === 'add' && canManageStyles && (
            <FormGroup label="Color (global)" fieldId="bulk-label-color">
              <div
                id="bulk-label-color"
                role="radiogroup"
                aria-label="Label color"
                style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={colorChoice === null}
                  aria-label="Don't change color"
                  disabled={busy}
                  onClick={() => setColorChoice(null)}
                  style={swatchStyle(colorChoice === null, busy)}
                >
                  <Label isCompact>Don&apos;t change</Label>
                </button>
                {ALL_LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={colorChoice === c}
                    aria-label={`Set color to ${c}`}
                    disabled={busy}
                    onClick={() => setColorChoice(c)}
                    style={swatchStyle(colorChoice === c, busy)}
                  >
                    <Label color={c} isCompact>
                      {c}
                    </Label>
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={colorChoice === 'auto'}
                  aria-label="Clear color override"
                  disabled={busy}
                  onClick={() => setColorChoice('auto')}
                  style={swatchStyle(colorChoice === 'auto', busy)}
                >
                  <Label isCompact>Auto (hash)</Label>
                </button>
              </div>
              <Content component="small">
                Applies globally to every chip with the typed key.
                <strong> Don&apos;t change</strong> leaves any existing
                override alone; <strong>Auto</strong> clears the
                override and falls back to the deterministic hash.
              </Content>
            </FormGroup>
          )}
          {error && (
            <Content component="small" style={{ color: 'var(--pf-t--global--color--status--danger--default)' }}>
              {error}
            </Content>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          isDisabled={busy || input.trim() === ''}
          onClick={() => void submit()}
        >
          {busy ? `${verb}ing…` : verb}
        </Button>
        <Button variant="link" isDisabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// swatchStyle highlights the chosen swatch with a border matching
// the rest of the picker on SystemLabelsCard; busy = cursor:wait so
// the operator sees the in-flight state without disabling the chip
// visual itself.
function swatchStyle(active: boolean, busy: boolean): React.CSSProperties {
  return {
    border: active
      ? '2px solid var(--pf-t--global--border--color--default)'
      : '2px solid transparent',
    background: 'transparent',
    padding: 2,
    cursor: busy ? 'wait' : 'pointer',
  }
}
