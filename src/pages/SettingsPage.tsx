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
const KEY_UPDATE_CONCURRENCY_LIMIT = 'update_concurrency_limit'
const KEY_PROBE_INTERVAL_SECONDS = 'probe_interval_seconds'
const KEY_PROBE_FAILURE_THRESHOLD = 'probe_failure_threshold'
const KEY_PROBE_SUCCESS_THRESHOLD = 'probe_success_threshold'

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
          <>
            <StackItem>
              <RunHistoryLimitCard
                value={state.settings[KEY_RUN_HISTORY_LIMIT] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
            <StackItem>
              <UpdateConcurrencyLimitCard
                value={state.settings[KEY_UPDATE_CONCURRENCY_LIMIT] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
            <StackItem>
              <ProbeIntervalCard
                value={state.settings[KEY_PROBE_INTERVAL_SECONDS] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
            <StackItem>
              <ProbeFailureThresholdCard
                value={state.settings[KEY_PROBE_FAILURE_THRESHOLD] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
            <StackItem>
              <ProbeSuccessThresholdCard
                value={state.settings[KEY_PROBE_SUCCESS_THRESHOLD] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
          </>
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

function UpdateConcurrencyLimitCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  const [input, setInput] = useState(value)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })

  useEffect(() => {
    if (value !== input) {
      setInput(value)
      setSave({ kind: 'idle' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSave({ kind: 'saving' })
    try {
      await setSetting(KEY_UPDATE_CONCURRENCY_LIMIT, input.trim())
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
      <CardTitle>Update concurrency</CardTitle>
      <CardBody>
        <Form id="update-concurrency-limit-form" onSubmit={onSubmit}>
          <FormGroup
            label="Simultaneous check / update runs"
            fieldId="update-concurrency-limit-input"
            isRequired
          >
            <TextInput
              id="update-concurrency-limit-input"
              type="number"
              min={1}
              max={100}
              value={input}
              onChange={(_e, v) => setInput(v)}
              isDisabled={save.kind === 'saving'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Cap on how many Check or Update tasks run at once across
                  the fleet. Extras queue in arrival order and start as
                  earlier runs finish. Range 1–100; default 4.
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
            form="update-concurrency-limit-form"
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

// BoundedIntCard is the shared form for the three reachability-probe
// settings. The existing RunHistoryLimitCard and
// UpdateConcurrencyLimitCard intentionally keep their own copies to
// match the pre-existing per-key shape; the three new probe cards
// route through here because all-new code is the right time to
// share the shape rather than ship it three times.
function BoundedIntCard({
  settingKey,
  title,
  label,
  helper,
  min,
  max,
  value,
  onSaved,
}: {
  settingKey: string
  title: string
  label: string
  helper: string
  min: number
  max: number
  value: string
  onSaved: () => void
}) {
  const [input, setInput] = useState(value)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const formId = `${settingKey}-form`
  const inputId = `${settingKey}-input`

  useEffect(() => {
    if (value !== input) {
      setInput(value)
      setSave({ kind: 'idle' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSave({ kind: 'saving' })
    try {
      await setSetting(settingKey, input.trim())
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
      <CardTitle>{title}</CardTitle>
      <CardBody>
        <Form id={formId} onSubmit={onSubmit}>
          <FormGroup label={label} fieldId={inputId} isRequired>
            <TextInput
              id={inputId}
              type="number"
              min={min}
              max={max}
              value={input}
              onChange={(_e, v) => setInput(v)}
              isDisabled={save.kind === 'saving'}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>{helper}</HelperTextItem>
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
            form={formId}
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

function ProbeIntervalCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  return (
    <BoundedIntCard
      settingKey={KEY_PROBE_INTERVAL_SECONDS}
      title="Reachability check frequency"
      label="Seconds between probe cycles"
      helper="How often the backend dials every system's SSH port to check reachability. Range 5–3600; default 30."
      min={5}
      max={3600}
      value={value}
      onSaved={onSaved}
    />
  )
}

function ProbeFailureThresholdCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  return (
    <BoundedIntCard
      settingKey={KEY_PROBE_FAILURE_THRESHOLD}
      title="Reachability failure threshold"
      label="Consecutive failures before Unreachable"
      helper="Number of probe failures in a row before a system flips to Unreachable. Higher values smooth over transient network blips at the cost of slower alerting. Range 1–10; default 1 (flip immediately)."
      min={1}
      max={10}
      value={value}
      onSaved={onSaved}
    />
  )
}

function ProbeSuccessThresholdCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  return (
    <BoundedIntCard
      settingKey={KEY_PROBE_SUCCESS_THRESHOLD}
      title="Reachability success threshold"
      label="Consecutive successes before Reachable"
      helper="Number of probe successes in a row before a system flips back to Reachable after being Unreachable. Higher values dampen flapping at the cost of slower recovery. Range 1–10; default 1 (flip immediately)."
      min={1}
      max={10}
      value={value}
      onSaved={onSaved}
    />
  )
}
