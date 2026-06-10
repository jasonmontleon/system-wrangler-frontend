// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Content,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
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
const KEY_SCHEDULE_MISFIRE_GRACE_SECONDS = 'schedule_misfire_grace_seconds'
const KEY_REBOOT_GRACE_SECONDS = 'reboot_grace_seconds'
const KEY_SHUTDOWN_GRACE_SECONDS = 'shutdown_grace_seconds'

// The subsystems whose log verbosity is independently adjustable. Each
// maps to a log_level_<component> setting key; the component name also
// appears as the `component` field on that subsystem's JSON log lines,
// so an operator can both turn one down here and grep for it. The first
// five are background loops; Prometheus Scrape is the request-path proxy
// Prometheus drives on every scrape.
const LOG_LEVEL_COMPONENTS: {
  key: string
  label: string
  description: string
}[] = [
  {
    key: 'log_level_probe',
    label: 'Reachability Probe',
    description: 'Dials each system to check whether it is reachable.',
  },
  {
    key: 'log_level_alert',
    label: 'Alert Evaluation',
    description:
      'Evaluates alert rules against metrics and reachability each cycle.',
  },
  {
    key: 'log_level_schedule',
    label: 'Schedule Runner',
    description: 'Fires scheduled check, apply, and reboot runs when due.',
  },
  {
    key: 'log_level_notification',
    label: 'Notification Delivery',
    description: 'Releases deferred notifications once quiet hours end.',
  },
  {
    key: 'log_level_promtargets',
    label: 'Prometheus Targets',
    description:
      'Rewrites the Prometheus discovery file on every inventory change.',
  },
  {
    key: 'log_level_scrape',
    label: 'Prometheus Scrape',
    description:
      'Proxies each Prometheus scrape to the host over SSH; warns when an exporter is unreachable — the busiest line on a large install.',
  },
  {
    key: 'log_level_request',
    label: 'HTTP Requests',
    description:
      'Per-request access log (method, path, status). API and UI requests log at Info; the high-volume internal Prometheus scrape requests are hidden. Set to Debug to also log scrape requests, or Warn to silence the access log entirely.',
  },
]

// LOG_LEVELS are the selectable verbosities, most to least chatty.
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

function logLevelDisplay(level: string): string {
  switch (level) {
    case 'debug':
      return 'Debug'
    case 'info':
      return 'Info'
    case 'warn':
      return 'Warn'
    case 'error':
      return 'Error'
    default:
      return level
  }
}

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
            <StackItem>
              <ScheduleMisfireGraceCard
                value={state.settings[KEY_SCHEDULE_MISFIRE_GRACE_SECONDS] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
            <StackItem>
              <RebootGraceCard
                value={state.settings[KEY_REBOOT_GRACE_SECONDS] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
            <StackItem>
              <ShutdownGraceCard
                value={state.settings[KEY_SHUTDOWN_GRACE_SECONDS] ?? ''}
                onSaved={() => void refresh()}
              />
            </StackItem>
            <StackItem>
              <LogLevelCard
                settings={state.settings}
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
                  every system. Extras queue in arrival order and start as
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

function ScheduleMisfireGraceCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  return (
    <BoundedIntCard
      settingKey={KEY_SCHEDULE_MISFIRE_GRACE_SECONDS}
      title="Schedule misfire grace"
      label="Seconds a run may slip before it is skipped"
      helper="How late a scheduled run may fire before it is treated as missed and rescheduled to its next occurrence instead of running. This stops a spike of catch-up runs when the server returns from an outage; a run delayed less than this (tick jitter, a quick restart) still fires. Range 60–3600; default 120 (2 minutes)."
      min={60}
      max={3600}
      value={value}
      onSaved={onSaved}
    />
  )
}

function RebootGraceCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  return (
    <BoundedIntCard
      settingKey={KEY_REBOOT_GRACE_SECONDS}
      title="Reboot-required grace"
      label="Seconds the apply stamp stays authoritative"
      helper="How long a freshly-applied system shows 'reboot required' from the apply itself before the sw_reboot_required metric takes over as the source of truth. It bridges the metric's catch-up lag (≈105s in a default setup: 60s textfile collector + 15s scrape + 30s SPA poll) so there's no flicker after an update, then hands off so the indicator clears within about a minute of an actual reboot. Lower it if your scrape is faster, raise it if slower. Range 10–1800; default 120 (2 minutes)."
      min={10}
      max={1800}
      value={value}
      onSaved={onSaved}
    />
  )
}

function ShutdownGraceCard({
  value,
  onSaved,
}: {
  value: string
  onSaved: () => void
}) {
  return (
    <BoundedIntCard
      settingKey={KEY_SHUTDOWN_GRACE_SECONDS}
      title="Shutdown drain grace"
      label="Seconds to drain in-flight runs before exiting"
      helper="On a shutdown signal the server stops accepting new check/apply/install runs (they return 503) and keeps draining the runs already in progress for up to this long before exiting. Runs that don't finish in time are abandoned and marked failed on the next start, which also clears the host lock so the system isn't stuck. Set the container or orchestrator stop timeout (podman --stop-timeout, Kubernetes terminationGracePeriodSeconds, systemd TimeoutStopSec) to at least this value, or the runtime will SIGKILL mid-drain. Range 60–1800; default 300 (5 minutes)."
      min={60}
      max={1800}
      value={value}
      onSaved={onSaved}
    />
  )
}

// LogLevelCard groups the per-subsystem verbosity selectors. Each
// change saves on its own and takes effect on the running server
// immediately — no restart required — so an admin can quieten a noisy
// subsystem or turn one up to debug while diagnosing an issue.
function LogLevelCard({
  settings,
  onSaved,
}: {
  settings: Settings
  onSaved: () => void
}) {
  return (
    <Card>
      <CardTitle>Logging</CardTitle>
      <CardBody>
        <Content component="p">
          Set how much each background loop and the Prometheus scrape proxy
          logs. Lines carry a <code>component</code> field matching the
          subsystem, so you can filter the JSON log stream (for example{' '}
          <code>jq &apos;select(.component==&quot;scrape&quot;)&apos;</code>).
          Changes apply immediately, no restart required. Default is Info; pick
          Warn or Error to quieten a subsystem, or Debug for per-cycle detail.
        </Content>
        <Form>
          {LOG_LEVEL_COMPONENTS.map((component) => (
            <LogLevelSelect
              key={component.key}
              component={component}
              value={settings[component.key] ?? 'info'}
              onSaved={onSaved}
            />
          ))}
        </Form>
      </CardBody>
    </Card>
  )
}

function LogLevelSelect({
  component,
  value,
  onSaved,
}: {
  component: { key: string; label: string; description: string }
  value: string
  onSaved: () => void
}) {
  const [current, setCurrent] = useState(value)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const inputId = `${component.key}-select`

  useEffect(() => {
    if (value !== current) {
      setCurrent(value)
      setSave({ kind: 'idle' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const onChange = async (
    _e: React.FormEvent<HTMLSelectElement>,
    level: string,
  ) => {
    setCurrent(level)
    setSave({ kind: 'saving' })
    try {
      await setSetting(component.key, level)
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
    <FormGroup label={component.label} fieldId={inputId}>
      <FormSelect
        id={inputId}
        value={current}
        onChange={onChange}
        isDisabled={save.kind === 'saving'}
        aria-label={`${component.label} log level`}
      >
        {LOG_LEVELS.map((level) => (
          <FormSelectOption
            key={level}
            value={level}
            label={logLevelDisplay(level)}
          />
        ))}
      </FormSelect>
      <FormHelperText>
        <HelperText>
          <HelperTextItem
            variant={save.kind === 'error' ? 'error' : 'default'}
          >
            {save.kind === 'error'
              ? `Could not save: ${save.message}`
              : save.kind === 'saved'
                ? `${component.description} Saved.`
                : component.description}
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
    </FormGroup>
  )
}
