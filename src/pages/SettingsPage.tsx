// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  TextInput,
  Title,
} from '@patternfly/react-core'
import { ApiError } from '../api/systems'
import { listSettings, setSetting, type Settings } from '../api/settings'

// Known settings render with a human label + description; unknown
// keys (left over from a downgrade) still surface as read-only
// rows so an operator can see what's stored without losing data.
const KEY_RUN_HISTORY_LIMIT = 'run_history_limit'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; settings: Settings }
  | { kind: 'error'; message: string }

export default function SettingsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const settings = await listSettings()
      setState({ kind: 'ready', settings })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1">Settings</Title>
        </StackItem>
        {state.kind === 'loading' && (
          <StackItem>
            <Bullseye>
              <Spinner />
            </Bullseye>
          </StackItem>
        )}
        {state.kind === 'error' && (
          <StackItem>
            <Alert variant="danger" title="Failed to load settings" isInline>
              {state.message}
            </Alert>
          </StackItem>
        )}
        {state.kind === 'ready' && (
          <StackItem>
            <RunHistoryLimitCard
              value={state.settings[KEY_RUN_HISTORY_LIMIT] ?? ''}
              onSaved={() => void refresh()}
            />
          </StackItem>
        )}
      </Stack>
    </PageSection>
  )
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

function RunHistoryLimitCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  const [input, setInput] = useState(value)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })

  // Only resync from props when the backend's value diverges from
  // what the user is currently editing. A successful save fires
  // onSaved → refresh → re-render with the same value the user
  // just typed; clobbering save state on that re-render would
  // wipe the success alert before it's visible.
  useEffect(() => {
    if (value !== input) {
      setInput(value)
      setSave({ kind: 'idle' })
    }
    // input is intentionally omitted from the dep array — we only
    // want to react to prop changes, not the user typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSave({ kind: 'saving' })
    try {
      await setSetting(KEY_RUN_HISTORY_LIMIT, input.trim())
      setSave({ kind: 'saved' })
      onSaved()
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      setSave({ kind: 'error', message: msg })
    }
  }

  return (
    <Card>
      <CardTitle>Run history retention</CardTitle>
      <CardBody>
        <Form id="run-history-limit-form" onSubmit={onSubmit}>
          <FormGroup
            label="Per-system row cap"
            fieldId="run-history-limit-input"
            isRequired
          >
            <TextInput
              id="run-history-limit-input"
              type="number"
              min={1}
              max={10000}
              value={input}
              onChange={(_e, v) => setInput(v)}
              isDisabled={save.kind === 'saving'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Each system keeps at most this many updater_runs rows.
                  The oldest are trimmed on each new run. Range 1–10000;
                  default 100.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          {save.kind === 'error' && (
            <Alert variant="danger" title="Could not save" isInline>
              {save.message}
            </Alert>
          )}
          {save.kind === 'saved' && (
            <Alert variant="success" title="Saved" isInline />
          )}
          <Button
            type="submit"
            form="run-history-limit-form"
            variant="primary"
            isLoading={save.kind === 'saving'}
            isDisabled={save.kind === 'saving' || input.trim() === ''}
          >
            Save
          </Button>
        </Form>
      </CardBody>
    </Card>
  )
}
