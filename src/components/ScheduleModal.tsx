// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  Select,
  SelectList,
  SelectOption,
  MenuToggle,
  type MenuToggleElement,
  Stack,
  StackItem,
  TextArea,
  TextInput,
} from '@patternfly/react-core'
import {
  createSchedule,
  type Schedule,
  type ScheduleInput,
  type TargetKind,
  updateSchedule,
} from '../api/schedules'
import { ApiError, listSystems, type System } from '../api/systems'
import { listGroups, type Group } from '../api/groups'

type Props = {
  // 'new' opens the modal in create mode; a Schedule opens it in
  // edit mode prefilled; null keeps it closed.
  target: Schedule | 'new' | null
  onClose: () => void
  onSaved: () => void
}

type FreqPreset = 'hourly' | 'daily' | 'weekly' | 'custom'

// presetToCron converts a high-level frequency picker into a 5-field
// cron expression. Custom returns null so the form preserves the
// user's own expression untouched.
function presetToCron(preset: FreqPreset, hour: number, minute: number, dow: number): string | null {
  switch (preset) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${dow}`
    case 'custom':
      return null
  }
}

export default function ScheduleModal({ target, onClose, onSaved }: Props) {
  const isOpen = target !== null
  const editing = target !== 'new' && target !== null ? target : null

  const [name, setName] = useState('')
  const [cronExpr, setCronExpr] = useState('0 3 * * *')
  const [timezone, setTimezone] = useState('UTC')
  const [preset, setPreset] = useState<FreqPreset>('daily')
  const [presetHour, setPresetHour] = useState(3)
  const [presetMinute, setPresetMinute] = useState(0)
  const [presetDow, setPresetDow] = useState(0)
  const [presetOpen, setPresetOpen] = useState(false)

  const [runCheck, setRunCheck] = useState(true)
  const [runApply, setRunApply] = useState(false)
  const [rebootAfterApply, setRebootAfterApply] = useState(false)

  const [targetKind, setTargetKind] = useState<TargetKind>('global')
  const [targetGroupID, setTargetGroupID] = useState('')
  const [targetGroupOpen, setTargetGroupOpen] = useState(false)
  const [targetSystemIDs, setTargetSystemIDs] = useState<string[]>([])
  const [targetSystemOpen, setTargetSystemOpen] = useState(false)
  const [targetSelector, setTargetSelector] = useState('')

  const [enabled, setEnabled] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [groups, setGroups] = useState<Group[]>([])
  const [systems, setSystems] = useState<System[]>([])

  // Reset the form on each open. Edit mode prefills from `editing`.
  useEffect(() => {
    if (!isOpen) return
    setSubmitting(false)
    setSubmitError(null)
    if (editing) {
      setName(editing.name)
      setCronExpr(editing.cronExpr)
      setTimezone(editing.timezone || 'UTC')
      setPreset('custom')
      setRunCheck(editing.runCheck)
      setRunApply(editing.runApply)
      setRebootAfterApply(editing.rebootAfterApply)
      setTargetKind(editing.targetKind)
      setTargetGroupID(editing.targetKind === 'group' ? editing.targetValue : '')
      setTargetSelector(editing.targetKind === 'selector' ? editing.targetValue : '')
      if (editing.targetKind === 'systems') {
        try {
          setTargetSystemIDs(JSON.parse(editing.targetValue) as string[])
        } catch {
          setTargetSystemIDs([])
        }
      } else {
        setTargetSystemIDs([])
      }
      setEnabled(editing.enabled)
    } else {
      setName('')
      setCronExpr('0 3 * * *')
      setTimezone('UTC')
      setPreset('daily')
      setPresetHour(3)
      setPresetMinute(0)
      setPresetDow(0)
      setRunCheck(true)
      setRunApply(false)
      setRebootAfterApply(false)
      setTargetKind('global')
      setTargetGroupID('')
      setTargetSystemIDs([])
      setTargetSelector('')
      setEnabled(true)
    }
  }, [isOpen, editing])

  // Lazily load the group + system inventories the first time the
  // modal opens. They rarely change during a single session and we
  // don't need a live subscription here.
  useEffect(() => {
    if (!isOpen) return
    listGroups().then(setGroups).catch(() => setGroups([]))
    listSystems().then(setSystems).catch(() => setSystems([]))
  }, [isOpen])

  // Recompute cron when a non-custom preset is active. Custom is the
  // only state where the user's typed cron expression survives.
  useEffect(() => {
    const expr = presetToCron(preset, presetHour, presetMinute, presetDow)
    if (expr !== null) setCronExpr(expr)
  }, [preset, presetHour, presetMinute, presetDow])

  if (!isOpen) return null

  const buildTargetValue = (): string => {
    switch (targetKind) {
      case 'global':
        return ''
      case 'group':
        return targetGroupID
      case 'systems':
        return JSON.stringify(targetSystemIDs)
      case 'selector':
        return targetSelector
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    const input: ScheduleInput = {
      name,
      cronExpr,
      timezone,
      runCheck,
      runApply,
      rebootAfterApply,
      targetKind,
      targetValue: buildTargetValue(),
      enabled,
    }
    try {
      if (editing) {
        await updateSchedule(editing.id, input)
      } else {
        await createSchedule(input)
      }
      onSaved()
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const validForSubmit = (() => {
    if (!name.trim()) return false
    if (!cronExpr.trim()) return false
    if (!runCheck && !runApply) return false
    if (rebootAfterApply && !runApply) return false
    if (targetKind === 'group' && !targetGroupID) return false
    if (targetKind === 'systems' && targetSystemIDs.length === 0) return false
    if (targetKind === 'selector' && !targetSelector.trim()) return false
    return true
  })()

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="schedule-modal-title"
    >
      <ModalHeader
        title={editing ? `Edit schedule: ${editing.name}` : 'New schedule'}
        labelId="schedule-modal-title"
      />
      <ModalBody>
        <Form id="schedule-form" onSubmit={onSubmit}>
          <FormGroup label="Name" fieldId="schedule-name" isRequired>
            <TextInput
              id="schedule-name"
              value={name}
              onChange={(_, v) => setName(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
            />
          </FormGroup>

          <FormGroup label="Frequency" fieldId="schedule-preset">
            <Select
              id="schedule-preset"
              isOpen={presetOpen}
              onOpenChange={setPresetOpen}
              selected={preset}
              onSelect={(_, v) => {
                setPreset(v as FreqPreset)
                setPresetOpen(false)
              }}
              toggle={(ref: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={ref}
                  isExpanded={presetOpen}
                  onClick={() => setPresetOpen((o) => !o)}
                  isDisabled={submitting}
                >
                  {presetLabel(preset)}
                </MenuToggle>
              )}
            >
              <SelectList>
                <SelectOption value="hourly">Hourly</SelectOption>
                <SelectOption value="daily">Daily</SelectOption>
                <SelectOption value="weekly">Weekly</SelectOption>
                <SelectOption value="custom">Custom (cron)</SelectOption>
              </SelectList>
            </Select>
            {preset === 'daily' && (
              <PresetTimeOfDay
                hour={presetHour}
                minute={presetMinute}
                onChange={(h, m) => {
                  setPresetHour(h)
                  setPresetMinute(m)
                }}
                disabled={submitting}
              />
            )}
            {preset === 'weekly' && (
              <>
                <PresetTimeOfDay
                  hour={presetHour}
                  minute={presetMinute}
                  onChange={(h, m) => {
                    setPresetHour(h)
                    setPresetMinute(m)
                  }}
                  disabled={submitting}
                />
                <PresetDayOfWeek
                  dow={presetDow}
                  onChange={setPresetDow}
                  disabled={submitting}
                />
              </>
            )}
            {preset === 'hourly' && (
              <PresetMinute
                minute={presetMinute}
                onChange={setPresetMinute}
                disabled={submitting}
              />
            )}
          </FormGroup>

          <FormGroup label="Cron expression" fieldId="schedule-cron" isRequired>
            <TextInput
              id="schedule-cron"
              value={cronExpr}
              onChange={(_, v) => {
                setCronExpr(v)
                setPreset('custom')
              }}
              isRequired
              isDisabled={submitting}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  5-field POSIX cron: minute hour day-of-month month day-of-week.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>

          <FormGroup label="Timezone" fieldId="schedule-tz">
            <TextInput
              id="schedule-tz"
              value={timezone}
              onChange={(_, v) => setTimezone(v)}
              isDisabled={submitting}
              placeholder="UTC"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>IANA name (e.g. <code>America/New_York</code>).</HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>

          <FormGroup label="Actions" fieldId="schedule-actions" isRequired>
            <Stack hasGutter>
              <StackItem>
                <Checkbox
                  id="schedule-check"
                  label="Run check on every targeted system"
                  isChecked={runCheck}
                  onChange={(_, v) => setRunCheck(v)}
                  isDisabled={submitting}
                />
              </StackItem>
              <StackItem>
                <Checkbox
                  id="schedule-apply"
                  label="Run apply on every targeted system"
                  isChecked={runApply}
                  onChange={(_, v) => {
                    setRunApply(v)
                    if (!v) setRebootAfterApply(false)
                  }}
                  isDisabled={submitting}
                />
              </StackItem>
              <StackItem>
                <Checkbox
                  id="schedule-reboot"
                  label="Reboot any system whose reboot-required flag is set after apply"
                  isChecked={rebootAfterApply}
                  onChange={(_, v) => setRebootAfterApply(v)}
                  isDisabled={submitting || !runApply}
                />
              </StackItem>
            </Stack>
          </FormGroup>

          <FormGroup label="Target" fieldId="schedule-target" isRequired>
            <Stack hasGutter>
              <StackItem>
                <Radio
                  id="target-global"
                  name="target-kind"
                  label="Every system"
                  isChecked={targetKind === 'global'}
                  onChange={() => setTargetKind('global')}
                  isDisabled={submitting}
                />
              </StackItem>
              <StackItem>
                <Radio
                  id="target-group"
                  name="target-kind"
                  label="A System Group"
                  isChecked={targetKind === 'group'}
                  onChange={() => setTargetKind('group')}
                  isDisabled={submitting}
                />
                {targetKind === 'group' && (
                  <Select
                    id="target-group-select"
                    isOpen={targetGroupOpen}
                    onOpenChange={setTargetGroupOpen}
                    selected={targetGroupID}
                    onSelect={(_, v) => {
                      setTargetGroupID(v as string)
                      setTargetGroupOpen(false)
                    }}
                    toggle={(ref: React.Ref<MenuToggleElement>) => (
                      <MenuToggle
                        ref={ref}
                        isExpanded={targetGroupOpen}
                        onClick={() => setTargetGroupOpen((o) => !o)}
                        isDisabled={submitting}
                      >
                        {targetGroupID
                          ? (groups.find((g) => g.id === targetGroupID)?.name ?? targetGroupID)
                          : 'Choose a group'}
                      </MenuToggle>
                    )}
                  >
                    <SelectList>
                      {groups.map((g) => (
                        <SelectOption key={g.id} value={g.id}>
                          {g.name}
                        </SelectOption>
                      ))}
                    </SelectList>
                  </Select>
                )}
              </StackItem>
              <StackItem>
                <Radio
                  id="target-systems"
                  name="target-kind"
                  label="A specific list of systems"
                  isChecked={targetKind === 'systems'}
                  onChange={() => setTargetKind('systems')}
                  isDisabled={submitting}
                />
                {targetKind === 'systems' && (
                  <Select
                    id="target-systems-select"
                    role="menu"
                    isOpen={targetSystemOpen}
                    onOpenChange={setTargetSystemOpen}
                    selected={targetSystemIDs}
                    onSelect={(_, v) => {
                      const id = v as string
                      setTargetSystemIDs((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }}
                    toggle={(ref: React.Ref<MenuToggleElement>) => (
                      <MenuToggle
                        ref={ref}
                        isExpanded={targetSystemOpen}
                        onClick={() => setTargetSystemOpen((o) => !o)}
                        isDisabled={submitting}
                      >
                        {targetSystemIDs.length === 0
                          ? 'Choose systems'
                          : `${targetSystemIDs.length} system${targetSystemIDs.length === 1 ? '' : 's'} selected`}
                      </MenuToggle>
                    )}
                  >
                    <SelectList>
                      {systems.map((sys) => (
                        <SelectOption
                          key={sys.id}
                          value={sys.id}
                          hasCheckbox
                          isSelected={targetSystemIDs.includes(sys.id)}
                        >
                          {sys.name}
                        </SelectOption>
                      ))}
                    </SelectList>
                  </Select>
                )}
              </StackItem>
              <StackItem>
                <Radio
                  id="target-selector"
                  name="target-kind"
                  label="A label selector"
                  isChecked={targetKind === 'selector'}
                  onChange={() => setTargetKind('selector')}
                  isDisabled={submitting}
                />
                {targetKind === 'selector' && (
                  <TextArea
                    id="target-selector-input"
                    aria-label="Label selector expression"
                    value={targetSelector}
                    onChange={(_, v) => setTargetSelector(v)}
                    isDisabled={submitting}
                    placeholder="env=prod,role in (web,api)"
                  />
                )}
              </StackItem>
            </Stack>
          </FormGroup>

          <FormGroup fieldId="schedule-enabled">
            <Checkbox
              id="schedule-enabled"
              label="Enabled"
              isChecked={enabled}
              onChange={(_, v) => setEnabled(v)}
              isDisabled={submitting}
            />
          </FormGroup>

          {submitError && (
            <Alert variant="danger" title="Could not save schedule" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="schedule-form"
          variant="primary"
          isLoading={submitting}
          isDisabled={submitting || !validForSubmit}
        >
          {editing ? 'Save' : 'Create'}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={submitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function presetLabel(p: FreqPreset): string {
  switch (p) {
    case 'hourly':
      return 'Hourly'
    case 'daily':
      return 'Daily'
    case 'weekly':
      return 'Weekly'
    case 'custom':
      return 'Custom (cron)'
  }
}

// PatternFly TextInput wraps the <input> in a 100%-width container,
// so a flex row of "At" + TextInput collapses the "At" span to a
// 1-column-wide ribbon if we don't pin sizes. flexShrink: 0 on the
// labels keeps them on one line; wrapping each input in a fixed-
// width div pins the input cluster.
const presetRowStyle: React.CSSProperties = {
  marginTop: '0.5rem',
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  flexWrap: 'wrap',
}
const presetLabelStyle: React.CSSProperties = { flexShrink: 0, whiteSpace: 'nowrap' }
const presetInputStyle: React.CSSProperties = { width: '5rem', flexShrink: 0 }

function PresetTimeOfDay({
  hour,
  minute,
  onChange,
  disabled,
}: {
  hour: number
  minute: number
  onChange: (h: number, m: number) => void
  disabled: boolean
}) {
  return (
    <div style={presetRowStyle}>
      <span style={presetLabelStyle}>At</span>
      <div style={presetInputStyle}>
        <TextInput
          aria-label="Hour"
          type="number"
          value={hour}
          onChange={(_, v) => {
            const n = Number(v)
            if (!Number.isNaN(n) && n >= 0 && n <= 23) onChange(n, minute)
          }}
          isDisabled={disabled}
        />
      </div>
      <span style={presetLabelStyle}>:</span>
      <div style={presetInputStyle}>
        <TextInput
          aria-label="Minute"
          type="number"
          value={minute}
          onChange={(_, v) => {
            const n = Number(v)
            if (!Number.isNaN(n) && n >= 0 && n <= 59) onChange(hour, n)
          }}
          isDisabled={disabled}
        />
      </div>
    </div>
  )
}

function PresetMinute({
  minute,
  onChange,
  disabled,
}: {
  minute: number
  onChange: (m: number) => void
  disabled: boolean
}) {
  return (
    <div style={presetRowStyle}>
      <span style={presetLabelStyle}>At minute</span>
      <div style={presetInputStyle}>
        <TextInput
          aria-label="Minute"
          type="number"
          value={minute}
          onChange={(_, v) => {
            const n = Number(v)
            if (!Number.isNaN(n) && n >= 0 && n <= 59) onChange(n)
          }}
          isDisabled={disabled}
        />
      </div>
    </div>
  )
}

function PresetDayOfWeek({
  dow,
  onChange,
  disabled,
}: {
  dow: number
  onChange: (d: number) => void
  disabled: boolean
}) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return (
    <div style={presetRowStyle}>
      <span style={presetLabelStyle}>On</span>
      <select
        aria-label="Day of week"
        value={dow}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      >
        {names.map((n, i) => (
          <option key={n} value={i}>
            {n}
          </option>
        ))}
      </select>
    </div>
  )
}
