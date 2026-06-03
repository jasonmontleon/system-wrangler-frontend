// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Spinner,
  Split,
  SplitItem,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core'
import {
  type DeliveryMode,
  getPolicy,
  type NotificationPolicy,
  type NotificationPolicyInput,
  type QuietWindow,
  setPolicy,
} from '../api/notifications'
import { ApiError } from '../api/systems'

const SEVERITIES = ['info', 'warning', 'critical'] as const
const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
}
// Built-in defaults, matching the backend, for a severity the policy omits.
const DEFAULT_MODES: Record<string, DeliveryMode> = {
  info: 'dashboard',
  warning: 'quiet',
  critical: 'always',
}
const MODE_OPTIONS: { value: DeliveryMode; label: string }[] = [
  { value: 'dashboard', label: 'Dashboard Only' },
  { value: 'quiet', label: 'Defer In Quiet Hours' },
  { value: 'always', label: 'Always Page' },
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Props = {
  // load/save default to the global policy endpoints; the personal
  // preferences card passes the /me variants to reuse this editor.
  load?: () => Promise<NotificationPolicy>
  save?: (input: NotificationPolicyInput) => Promise<NotificationPolicy>
  title?: string
}

// DeliveryPolicyCard edits a delivery policy — the per-severity delivery
// mode plus the quiet-hours schedule. By default it edits the global policy
// (Global Admin); with load/save props it edits the caller's personal
// policy. RBAC is enforced server-side and errors surface inline. The
// dashboard always shows active alerts regardless of this policy.
export default function DeliveryPolicyCard({ load: loadProp, save: saveProp, title }: Props = {}) {
  const loadPolicy = loadProp ?? getPolicy
  const savePolicy = saveProp ?? setPolicy
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [timezone, setTimezone] = useState('UTC')
  const [windows, setWindows] = useState<QuietWindow[]>([])
  const [severities, setSeverities] = useState<Record<string, DeliveryMode>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(() => {
    loadPolicy()
      .then((p: NotificationPolicy) => {
        setTimezone(p.timezone || 'UTC')
        setWindows(p.windows ?? [])
        setSeverities(p.severities ?? {})
        setLoading(false)
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [loadPolicy])

  useEffect(() => load(), [load])

  const modeFor = (sev: string): DeliveryMode => severities[sev] ?? DEFAULT_MODES[sev]

  const setMode = (sev: string, mode: DeliveryMode) => {
    setSeverities((prev) => ({ ...prev, [sev]: mode }))
    setSaved(false)
  }

  const updateWindow = (i: number, patch: Partial<QuietWindow>) => {
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)))
    setSaved(false)
  }

  const toggleDay = (i: number, day: number, on: boolean) => {
    const w = windows[i]
    const days = on ? [...w.days, day].sort((a, b) => a - b) : w.days.filter((d) => d !== day)
    updateWindow(i, { days })
  }

  const addWindow = () => {
    setWindows((prev) => [...prev, { days: [], start: '22:00', end: '08:00' }])
    setSaved(false)
  }

  const removeWindow = (i: number) => {
    setWindows((prev) => prev.filter((_, idx) => idx !== i))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const stored = await savePolicy({ timezone, windows, severities })
      setTimezone(stored.timezone)
      setWindows(stored.windows ?? [])
      setSeverities(stored.severities ?? {})
      setSaved(true)
    } catch (err) {
      setSaveError(err instanceof ApiError || err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardTitle>{title ?? 'Delivery Policy'}</CardTitle>
      <CardBody>
        {loading ? (
          <Bullseye>
            <Spinner aria-label="Loading delivery policy" />
          </Bullseye>
        ) : loadError ? (
          <Alert variant="danger" title="Could not load delivery policy" isInline>
            {loadError}
          </Alert>
        ) : (
          <Form>
            <Stack hasGutter>
              <StackItem>
                <p>
                  Each severity delivers to channels by its mode; quiet hours defer non-paging
                  alerts until the window ends. The dashboard always shows active alerts.
                </p>
              </StackItem>

              {SEVERITIES.map((sev) => (
                <StackItem key={sev}>
                  <FormGroup label={`${SEVERITY_LABELS[sev]} severity`} fieldId={`mode-${sev}`}>
                    <FormSelect
                      id={`mode-${sev}`}
                      value={modeFor(sev)}
                      aria-label={`${SEVERITY_LABELS[sev]} delivery mode`}
                      onChange={(_, v) => setMode(sev, v as DeliveryMode)}
                      isDisabled={saving}
                    >
                      {MODE_OPTIONS.map((o) => (
                        <FormSelectOption key={o.value} value={o.value} label={o.label} />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </StackItem>
              ))}

              <StackItem>
                <FormGroup label="Quiet hours timezone" fieldId="policy-timezone">
                  <TextInput
                    id="policy-timezone"
                    value={timezone}
                    aria-label="Quiet hours timezone"
                    onChange={(_, v) => {
                      setTimezone(v)
                      setSaved(false)
                    }}
                    isDisabled={saving}
                    placeholder="America/New_York"
                  />
                </FormGroup>
              </StackItem>

              {windows.length === 0 && (
                <StackItem>
                  <Alert variant="info" title="No quiet windows" isInline>
                    Without a window, quiet-mode severities deliver immediately. Add one to defer
                    them overnight.
                  </Alert>
                </StackItem>
              )}

              {windows.map((w, i) => (
                <StackItem key={i}>
                  <Split hasGutter>
                    <SplitItem isFilled>
                      <FormGroup label={`Window ${i + 1} days`} fieldId={`window-${i}-days`} role="group">
                        <Split>
                          {WEEKDAYS.map((label, day) => (
                            <SplitItem key={day} style={{ marginRight: '0.75rem' }}>
                              <Checkbox
                                id={`window-${i}-day-${day}`}
                                label={label}
                                aria-label={`Window ${i + 1} ${label}`}
                                isChecked={w.days.includes(day)}
                                isDisabled={saving}
                                onChange={(_, on) => toggleDay(i, day, on)}
                              />
                            </SplitItem>
                          ))}
                        </Split>
                      </FormGroup>
                    </SplitItem>
                    <SplitItem>
                      <FormGroup label="Start" fieldId={`window-${i}-start`}>
                        <TextInput
                          id={`window-${i}-start`}
                          type="time"
                          value={w.start}
                          aria-label={`Window ${i + 1} start`}
                          onChange={(_, v) => updateWindow(i, { start: v })}
                          isDisabled={saving}
                        />
                      </FormGroup>
                    </SplitItem>
                    <SplitItem>
                      <FormGroup label="End" fieldId={`window-${i}-end`}>
                        <TextInput
                          id={`window-${i}-end`}
                          type="time"
                          value={w.end}
                          aria-label={`Window ${i + 1} end`}
                          onChange={(_, v) => updateWindow(i, { end: v })}
                          isDisabled={saving}
                        />
                      </FormGroup>
                    </SplitItem>
                    <SplitItem>
                      <FormGroup label=" " fieldId={`window-${i}-remove`}>
                        <Button
                          variant="link"
                          isDanger
                          onClick={() => removeWindow(i)}
                          isDisabled={saving}
                          aria-label={`Remove window ${i + 1}`}
                        >
                          Remove
                        </Button>
                      </FormGroup>
                    </SplitItem>
                  </Split>
                </StackItem>
              ))}

              <StackItem>
                <Button variant="secondary" onClick={addWindow} isDisabled={saving}>
                  Add window
                </Button>
              </StackItem>

              {saveError && (
                <StackItem>
                  <Alert variant="danger" title="Could not save delivery policy" isInline>
                    {saveError}
                  </Alert>
                </StackItem>
              )}
              {saved && (
                <StackItem>
                  <Alert variant="success" title="Delivery policy saved" isInline />
                </StackItem>
              )}

              <StackItem>
                <Button variant="primary" onClick={() => void save()} isLoading={saving} isDisabled={saving}>
                  Save policy
                </Button>
              </StackItem>
            </Stack>
          </Form>
        )}
      </CardBody>
    </Card>
  )
}
