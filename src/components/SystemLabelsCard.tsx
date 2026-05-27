// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Content,
  Form,
  FormGroup,
  Label,
  LabelGroup,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core'
import { deleteSystemLabel, setSystemLabel, type Label as LabelType } from '../api/labels'
import {
  deleteLabelStyle,
  setLabelStyle,
  type LabelColor,
  type LabelStyleMap,
} from '../api/labelStyles'
import { ApiError } from '../api/systems'
import { colorFor } from '../lib/labelColors'
import LabelColorPicker from './LabelColorPicker'

type Props = {
  systemId: string
  labels: LabelType[] | undefined
  canEdit: boolean
  // canManageStyles, when true, lets the user click a chip to open
  // the color-override picker. Global Admin only per the backend
  // RBAC gate on /api/label-styles.
  canManageStyles?: boolean
  styleOverrides?: LabelStyleMap
  onChange: () => void | Promise<void>
}

// SystemLabelsCard is the per-system editor that lives on the detail
// page's Overview tab. Read-only viewers see the chip list; operators
// + admins get an "Add label" form below it and an "x" affordance on
// each chip. The single-text-input form mirrors the selector grammar
// the filter bar above uses: `env=prod` for k=v, `oncall` for a bare
// tag. Backend validation errors (reserved prefix, bad charset, length
// caps) surface inline so the operator can correct without leaving
// the page.
export default function SystemLabelsCard({
  systemId,
  labels,
  canEdit,
  canManageStyles = false,
  styleOverrides,
  onChange,
}: Props) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // editingKey is the label key whose color-override picker is open
  // (Global Admin only). Mutually-exclusive with the regular edit
  // flow; setting a style is a global operation distinct from
  // adding/removing the per-system label row.
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const list = labels ?? []
  const editing = editingKey ? list.find((l) => l.key === editingKey) : null

  const applyStyle = async (color: LabelColor) => {
    if (!editingKey) return
    setError(null)
    setBusy(true)
    try {
      await setLabelStyle(editingKey, color)
      setEditingKey(null)
      await onChange()
    } catch (err) {
      setError(extractMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const clearStyle = async () => {
    if (!editingKey) return
    setError(null)
    setBusy(true)
    try {
      await deleteLabelStyle(editingKey)
      setEditingKey(null)
      await onChange()
    } catch (err) {
      setError(extractMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    const text = input.trim()
    if (text === '') return
    const eq = text.indexOf('=')
    const key = (eq === -1 ? text : text.slice(0, eq)).trim()
    const value = eq === -1 ? null : text.slice(eq + 1)
    if (key === '') {
      setError('Key is required.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await setSystemLabel(systemId, key, value)
      setInput('')
      await onChange()
    } catch (err) {
      setError(extractMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (key: string) => {
    setError(null)
    setBusy(true)
    try {
      await deleteSystemLabel(systemId, key)
      await onChange()
    } catch (err) {
      setError(extractMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardTitle>Labels</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            {list.length === 0 ? (
              <Content component="small">No labels.</Content>
            ) : (
              <LabelGroup numLabels={20} aria-label="System labels">
                {list.map((l) => (
                  <Label
                    key={l.key}
                    color={colorFor(l.key, styleOverrides)}
                    onClose={
                      canEdit && !busy ? () => void remove(l.key) : undefined
                    }
                    onClick={
                      canManageStyles && !busy
                        ? () => setEditingKey(l.key)
                        : undefined
                    }
                    closeBtnAriaLabel={`Remove ${l.key}`}
                  >
                    {format(l)}
                  </Label>
                ))}
              </LabelGroup>
            )}
          </StackItem>
          {canEdit && (
            <StackItem>
              <Form
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <FormGroup label="Add label" fieldId={`label-add-${systemId}`}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <TextInput
                      id={`label-add-${systemId}`}
                      aria-label="New label"
                      placeholder="env=prod or oncall for a bare tag"
                      value={input}
                      isDisabled={busy}
                      onChange={(_, v) => setInput(v)}
                    />
                    <Button
                      variant="secondary"
                      type="submit"
                      isDisabled={busy || input.trim() === ''}
                    >
                      Add
                    </Button>
                  </div>
                </FormGroup>
              </Form>
              <Content component="small">
                Keys follow the k8s subset: <code>[a-zA-Z0-9._-]</code> with
                an optional <code>prefix/</code> segment.{' '}
                <code>system-wrangler.io/</code> is reserved.
              </Content>
            </StackItem>
          )}
          {editing && (
            <StackItem>
              <LabelColorPicker
                labelText={format(editing)}
                currentColor={colorFor(editing.key, styleOverrides)}
                hasOverride={!!styleOverrides && editing.key in styleOverrides}
                isBusy={busy}
                onSelect={(c) => void applyStyle(c)}
                onReset={() => void clearStyle()}
                onCancel={() => setEditingKey(null)}
              />
            </StackItem>
          )}
          {error && (
            <StackItem>
              <Alert variant="danger" isInline title="Could not update labels">
                {error}
              </Alert>
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}

// format renders one label for chip display. Matches the selector
// grammar (bare key for null, key=value otherwise) so the chip text
// on the card reads the same as the filter-bar tokens on the list
// page.
function format(l: LabelType): string {
  return l.value === null ? l.key : `${l.key}=${l.value}`
}

// extractMessage pulls the operator-readable string out of an
// ApiError (already carries the backend's `error` field) or falls
// back to the Error message / String(err) for everything else.
function extractMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}
