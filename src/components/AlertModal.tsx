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
  InputGroup,
  InputGroupText,
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
  type AlertCatalogEntry,
  type AlertMetric,
  type AlertRule,
  type AlertRuleInput,
  type Comparator,
  type ConditionKind,
  createAlertRule,
  listAlertCatalog,
  type Severity,
  type TargetKind,
  updateAlertRule,
} from '../api/alerts'
import { ApiError, listSystems, type System } from '../api/systems'
import { listGroups, type Group } from '../api/groups'

type Props = {
  // 'new' opens the modal in create mode; an AlertRule opens it in
  // edit mode prefilled; null keeps it closed.
  target: AlertRule | 'new' | null
  onClose: () => void
  onSaved: () => void
}

const COMPARATORS: { value: Comparator; label: string }[] = [
  { value: 'gt', label: 'is above (>)' },
  { value: 'gte', label: 'is at or above (≥)' },
  { value: 'lt', label: 'is below (<)' },
  { value: 'lte', label: 'is at or below (≤)' },
]

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
]

export default function AlertModal({ target, onClose, onSaved }: Props) {
  const isOpen = target !== null
  const editing = target !== 'new' && target !== null ? target : null

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [conditionKind, setConditionKind] = useState<ConditionKind>('metric')
  const [metric, setMetric] = useState<AlertMetric>('mem_used_pct')
  const [metricOpen, setMetricOpen] = useState(false)
  const [expr, setExpr] = useState('')
  const [comparator, setComparator] = useState<Comparator>('gt')
  const [comparatorOpen, setComparatorOpen] = useState(false)
  const [threshold, setThreshold] = useState('90')
  const [forMinutes, setForMinutes] = useState('5')
  const [severity, setSeverity] = useState<Severity>('warning')
  const [severityOpen, setSeverityOpen] = useState(false)

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
  const [catalog, setCatalog] = useState<AlertCatalogEntry[]>([])

  // Reset the form on each open. Edit mode prefills from `editing`.
  useEffect(() => {
    if (!isOpen) return
    setSubmitting(false)
    setSubmitError(null)
    if (editing) {
      setName(editing.name)
      setDescription(editing.description ?? '')
      setConditionKind(editing.conditionKind)
      setMetric(editing.metric ?? 'mem_used_pct')
      setExpr(editing.expr ?? '')
      setComparator(editing.comparator ?? 'gt')
      setThreshold(String(editing.threshold))
      setForMinutes(String(Math.round(editing.forSeconds / 60)))
      setSeverity(editing.severity)
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
      setDescription('')
      setConditionKind('metric')
      setMetric('mem_used_pct')
      setExpr('')
      setComparator('gt')
      setThreshold('90')
      setForMinutes('5')
      setSeverity('warning')
      setTargetKind('global')
      setTargetGroupID('')
      setTargetSystemIDs([])
      setTargetSelector('')
      setEnabled(true)
    }
  }, [isOpen, editing])

  // Lazily load groups, systems, and the metric catalog the first time
  // the modal opens. They rarely change during a single session.
  useEffect(() => {
    if (!isOpen) return
    listGroups().then(setGroups).catch(() => setGroups([]))
    listSystems().then(setSystems).catch(() => setSystems([]))
    listAlertCatalog().then(setCatalog).catch(() => setCatalog([]))
  }, [isOpen])

  if (!isOpen) return null

  const metricUnit =
    catalog.find((c) => c.metric === metric)?.unit ?? ''
  const metricLabel = (m: AlertMetric): string =>
    catalog.find((c) => c.metric === m)?.label ?? m

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
    const input: AlertRuleInput = {
      name,
      description: description.trim() || undefined,
      conditionKind,
      metric: conditionKind === 'metric' ? metric : undefined,
      expr: conditionKind === 'promql' ? expr : undefined,
      comparator: conditionKind === 'unreachable' ? undefined : comparator,
      threshold: conditionKind === 'unreachable' ? 0 : Number(threshold),
      forSeconds: Math.max(0, Math.round(Number(forMinutes) * 60)),
      severity,
      targetKind,
      targetValue: buildTargetValue(),
      enabled,
    }
    try {
      if (editing) {
        await updateAlertRule(editing.id, input)
      } else {
        await createAlertRule(input)
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

  const thresholdValid =
    threshold.trim() !== '' && Number.isFinite(Number(threshold))
  const forValid =
    forMinutes.trim() !== '' &&
    Number.isFinite(Number(forMinutes)) &&
    Number(forMinutes) >= 0

  const validForSubmit = (() => {
    if (!name.trim()) return false
    if (!forValid) return false
    if (conditionKind === 'metric' && !thresholdValid) return false
    if (conditionKind === 'promql' && (!expr.trim() || !thresholdValid)) return false
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
      aria-labelledby="alert-modal-title"
    >
      <ModalHeader
        title={editing ? `Edit alert rule: ${editing.name}` : 'New alert rule'}
        labelId="alert-modal-title"
      />
      <ModalBody>
        <Form id="alert-form" onSubmit={onSubmit}>
          <FormGroup label="Name" fieldId="alert-name" isRequired>
            <TextInput
              id="alert-name"
              value={name}
              onChange={(_, v) => setName(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
            />
          </FormGroup>

          <FormGroup label="Description" fieldId="alert-description">
            <TextInput
              id="alert-description"
              value={description}
              onChange={(_, v) => setDescription(v)}
              isDisabled={submitting}
              placeholder="Optional"
            />
          </FormGroup>

          <FormGroup label="Condition" fieldId="alert-condition" isRequired>
            <Stack hasGutter>
              <StackItem>
                <Radio
                  id="condition-metric"
                  name="condition-kind"
                  label="A metric crosses a threshold"
                  isChecked={conditionKind === 'metric'}
                  onChange={() => setConditionKind('metric')}
                  isDisabled={submitting}
                />
              </StackItem>
              <StackItem>
                <Radio
                  id="condition-promql"
                  name="condition-kind"
                  label="A custom PromQL expression crosses a threshold"
                  isChecked={conditionKind === 'promql'}
                  onChange={() => setConditionKind('promql')}
                  isDisabled={submitting}
                />
              </StackItem>
              <StackItem>
                <Radio
                  id="condition-unreachable"
                  name="condition-kind"
                  label="A system is unreachable"
                  isChecked={conditionKind === 'unreachable'}
                  onChange={() => setConditionKind('unreachable')}
                  isDisabled={submitting}
                />
              </StackItem>
            </Stack>
          </FormGroup>

          {conditionKind === 'metric' && (
            <FormGroup label="Metric" fieldId="alert-metric" isRequired>
              <Select
                id="alert-metric"
                isOpen={metricOpen}
                onOpenChange={setMetricOpen}
                selected={metric}
                onSelect={(_, v) => {
                  setMetric(v as AlertMetric)
                  setMetricOpen(false)
                }}
                toggle={(ref: React.Ref<MenuToggleElement>) => (
                  <MenuToggle
                    ref={ref}
                    isExpanded={metricOpen}
                    onClick={() => setMetricOpen((o) => !o)}
                    isDisabled={submitting}
                  >
                    {metricLabel(metric)}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  {catalog.map((c) => (
                    <SelectOption key={c.metric} value={c.metric}>
                      {c.label}
                      {c.unit ? ` (${c.unit})` : ''}
                    </SelectOption>
                  ))}
                </SelectList>
              </Select>
            </FormGroup>
          )}

          {conditionKind === 'promql' && (
            <FormGroup label="PromQL expression" fieldId="alert-expr" isRequired>
              <TextArea
                id="alert-expr"
                aria-label="PromQL rule expression"
                value={expr}
                onChange={(_, v) => setExpr(v)}
                isDisabled={submitting}
                placeholder='avg by (system_id)(rate(node_cpu_seconds_total{mode="idle"}[5m]))'
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Must return one value per system (carry a{' '}
                    <code>system_id</code> label).
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}

          {conditionKind !== 'unreachable' && (
            <FormGroup label="Threshold" fieldId="alert-threshold" isRequired>
              <Stack hasGutter>
                <StackItem>
                  <Select
                    id="alert-comparator"
                    isOpen={comparatorOpen}
                    onOpenChange={setComparatorOpen}
                    selected={comparator}
                    onSelect={(_, v) => {
                      setComparator(v as Comparator)
                      setComparatorOpen(false)
                    }}
                    toggle={(ref: React.Ref<MenuToggleElement>) => (
                      <MenuToggle
                        ref={ref}
                        isExpanded={comparatorOpen}
                        onClick={() => setComparatorOpen((o) => !o)}
                        isDisabled={submitting}
                      >
                        {COMPARATORS.find((c) => c.value === comparator)?.label}
                      </MenuToggle>
                    )}
                  >
                    <SelectList>
                      {COMPARATORS.map((c) => (
                        <SelectOption key={c.value} value={c.value}>
                          {c.label}
                        </SelectOption>
                      ))}
                    </SelectList>
                  </Select>
                </StackItem>
                <StackItem>
                  <InputGroup>
                    <TextInput
                      id="alert-threshold"
                      type="number"
                      aria-label="Threshold value"
                      value={threshold}
                      onChange={(_, v) => setThreshold(v)}
                      isDisabled={submitting}
                      validated={thresholdValid ? 'default' : 'error'}
                    />
                    {conditionKind === 'metric' && metricUnit && (
                      <InputGroupText>{metricUnit}</InputGroupText>
                    )}
                  </InputGroup>
                </StackItem>
              </Stack>
            </FormGroup>
          )}

          <FormGroup label="For" fieldId="alert-for" isRequired>
            <InputGroup>
              <TextInput
                id="alert-for"
                type="number"
                aria-label="For minutes"
                value={forMinutes}
                onChange={(_, v) => setForMinutes(v)}
                isDisabled={submitting}
                validated={forValid ? 'default' : 'error'}
              />
              <InputGroupText>minutes</InputGroupText>
            </InputGroup>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  How long the condition must hold before the alert fires
                  (0 = immediately).
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>

          <FormGroup label="Severity" fieldId="alert-severity" isRequired>
            <Select
              id="alert-severity"
              isOpen={severityOpen}
              onOpenChange={setSeverityOpen}
              selected={severity}
              onSelect={(_, v) => {
                setSeverity(v as Severity)
                setSeverityOpen(false)
              }}
              toggle={(ref: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={ref}
                  isExpanded={severityOpen}
                  onClick={() => setSeverityOpen((o) => !o)}
                  isDisabled={submitting}
                >
                  {SEVERITIES.find((s) => s.value === severity)?.label}
                </MenuToggle>
              )}
            >
              <SelectList>
                {SEVERITIES.map((s) => (
                  <SelectOption key={s.value} value={s.value}>
                    {s.label}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </FormGroup>

          <FormGroup label="Target" fieldId="alert-target" isRequired>
            <Stack hasGutter>
              <StackItem>
                <Radio
                  id="alert-target-global"
                  name="alert-target-kind"
                  label="Every system"
                  isChecked={targetKind === 'global'}
                  onChange={() => setTargetKind('global')}
                  isDisabled={submitting}
                />
              </StackItem>
              <StackItem>
                <Radio
                  id="alert-target-group"
                  name="alert-target-kind"
                  label="A System Group"
                  isChecked={targetKind === 'group'}
                  onChange={() => setTargetKind('group')}
                  isDisabled={submitting}
                />
                {targetKind === 'group' && (
                  <Select
                    id="alert-target-group-select"
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
                  id="alert-target-systems"
                  name="alert-target-kind"
                  label="A specific list of systems"
                  isChecked={targetKind === 'systems'}
                  onChange={() => setTargetKind('systems')}
                  isDisabled={submitting}
                />
                {targetKind === 'systems' && (
                  <Select
                    id="alert-target-systems-select"
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
                  id="alert-target-selector"
                  name="alert-target-kind"
                  label="A label selector"
                  isChecked={targetKind === 'selector'}
                  onChange={() => setTargetKind('selector')}
                  isDisabled={submitting}
                />
                {targetKind === 'selector' && (
                  <TextArea
                    id="alert-target-selector-input"
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

          <FormGroup fieldId="alert-enabled">
            <Checkbox
              id="alert-enabled"
              label="Enabled"
              isChecked={enabled}
              onChange={(_, v) => setEnabled(v)}
              isDisabled={submitting}
            />
          </FormGroup>

          {submitError && (
            <Alert variant="danger" title="Could not save alert rule" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="alert-form"
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
