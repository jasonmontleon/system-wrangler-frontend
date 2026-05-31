// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, type DragEvent } from 'react'
import {
  Button,
  Checkbox,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  TrashIcon,
} from '@patternfly/react-icons'
import {
  appendInstance,
  moveEntry,
  removeEntry,
  reorder,
  setEntryEnabled,
  type LayoutEntry,
} from '../hooks/useDashboardLayout'
import {
  BLANK_WIDGET_IDS,
  TEMPLATED_WIDGETS,
  WIDGETS_BY_ID,
  type WidgetId,
} from '../dashboard/widgets'
import type { Group } from '../api/groups'

const BLANK_SET = new Set<WidgetId>(BLANK_WIDGET_IDS)
const GROUP_TEMPLATES = TEMPLATED_WIDGETS.filter((w) => !BLANK_SET.has(w.id))

type Props = {
  isOpen: boolean
  layout: LayoutEntry[]
  groups: Group[]
  onApply: (next: LayoutEntry[]) => void
  onReset: () => LayoutEntry[]
  onClose: () => void
}

// CustomizeDashboardModal lets the user reorder, enable/disable, and
// manage per-group instances of templated widgets. Widget sizes are
// fixed in the registry — users do not pick heights. Edits buffer
// locally and only commit on Apply, so Cancel restores the prior
// layout.
export default function CustomizeDashboardModal({
  isOpen,
  layout,
  groups,
  onApply,
  onReset,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<LayoutEntry[]>(layout)
  const [addWidgetId, setAddWidgetId] = useState<WidgetId | ''>('')
  const [addGroupId, setAddGroupId] = useState<string>('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  useEffect(() => {
    if (isOpen) {
      setDraft(layout)
      setAddWidgetId(GROUP_TEMPLATES[0]?.id ?? '')
      setAddGroupId(groups[0]?.id ?? '')
    }
  }, [isOpen, layout, groups])

  if (!isOpen) return null

  const apply = () => {
    onApply(draft)
    onClose()
  }
  const reset = () => {
    setDraft(onReset())
  }
  const move = (index: number, delta: number) => {
    setDraft((d) => moveEntry(d, index, delta))
  }
  const toggle = (instanceId: string, enabled: boolean) => {
    setDraft((d) => setEntryEnabled(d, instanceId, enabled))
  }
  const remove = (instanceId: string) => {
    setDraft((d) => removeEntry(d, instanceId))
  }
  const addInstance = () => {
    if (!addWidgetId || !addGroupId) return
    setDraft((d) => appendInstance(d, addWidgetId, { groupId: addGroupId }))
  }
  const addBlank = (widgetId: WidgetId) => {
    setDraft((d) => appendInstance(d, widgetId))
  }

  // Drag-and-drop reordering. The whole row is draggable but the
  // visible grip icon at the left is the affordance. dragstart records
  // the source index, dragover on each row recomputes the insertion
  // point (above or below this row, based on cursor Y vs midpoint),
  // and dragend commits the move via the reorder helper. Touch
  // platforms don't fire HTML5 drag events — keyboard / mouse users
  // still have the ↑/↓ buttons as a fallback.
  const onRowDragStart = (index: number) => (e: DragEvent<HTMLLIElement>) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
  const onRowDragOver = (index: number) => (e: DragEvent<HTMLLIElement>) => {
    if (dragIndex === null) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    setDropAt(e.clientY < midpoint ? index : index + 1)
  }
  const onRowDragEnd = () => {
    if (dragIndex !== null && dropAt !== null) {
      setDraft((d) => reorder(d, dragIndex, dropAt))
    }
    setDragIndex(null)
    setDropAt(null)
  }
  const onListDrop = (e: DragEvent<HTMLUListElement>) => {
    e.preventDefault()
  }

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="customize-dashboard-title"
    >
      <ModalHeader
        title="Customize dashboard"
        labelId="customize-dashboard-title"
        description="Show or hide widgets and reorder them. Widget sizes are fixed per widget."
      />
      <ModalBody>
        <ul
          aria-label="Dashboard widgets"
          onDrop={onListDrop}
          onDragOver={(e) => {
            if (dragIndex !== null) e.preventDefault()
          }}
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          {draft.map((entry, index) => {
            const spec = WIDGETS_BY_ID.get(entry.widgetId)
            if (!spec) return null
            const groupName = entry.params?.groupId
              ? (groups.find((g) => g.id === entry.params?.groupId)?.name ??
                'unknown group')
              : null
            const rowTitle = groupName
              ? `${spec.title.replace(/ \(per group\)$/, '')} — ${groupName}`
              : spec.title
            const isDragging = dragIndex === index
            // Show a drop indicator above this row when the insertion
            // point is exactly here and the move would actually change
            // ordering (skipping the no-op cases where the dragged row
            // would land on itself).
            const showDropAbove =
              dropAt === index &&
              dragIndex !== null &&
              dragIndex !== index &&
              dragIndex !== index - 1
            const showDropBelow =
              index === draft.length - 1 &&
              dropAt === index + 1 &&
              dragIndex !== null &&
              dragIndex !== index &&
              dragIndex !== index + 1
            return (
              <li
                key={entry.instanceId}
                draggable
                onDragStart={onRowDragStart(index)}
                onDragOver={onRowDragOver(index)}
                onDragEnd={onRowDragEnd}
                style={{
                  border: '1px solid var(--pf-t--global--border--color--default)',
                  borderRadius: 4,
                  padding: '0.5rem 0.75rem',
                  opacity: isDragging ? 0.4 : 1,
                  boxShadow:
                    [
                      showDropAbove
                        ? 'inset 0 2px 0 var(--pf-t--global--color--brand--default)'
                        : '',
                      showDropBelow
                        ? 'inset 0 -2px 0 var(--pf-t--global--color--brand--default)'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(', ') || undefined,
                }}
              >
                <Flex
                  alignItems={{ default: 'alignItemsCenter' }}
                  spaceItems={{ default: 'spaceItemsMd' }}
                >
                  <FlexItem>
                    <span
                      aria-hidden
                      style={{
                        cursor: 'grab',
                        color: 'var(--pf-t--global--text--color--subtle)',
                        display: 'inline-flex',
                      }}
                      title="Drag to reorder"
                    >
                      <GripVerticalIcon />
                    </span>
                  </FlexItem>
                  <FlexItem>
                    <Checkbox
                      id={`widget-enabled-${entry.instanceId}`}
                      isChecked={entry.enabled}
                      onChange={(_, checked) => toggle(entry.instanceId, checked)}
                      aria-label={`Show ${rowTitle}`}
                    />
                  </FlexItem>
                  <FlexItem flex={{ default: 'flex_1' }}>
                    <div style={{ fontWeight: 600 }}>{rowTitle}</div>
                    {spec.description && (
                      <div
                        style={{
                          color: 'var(--pf-t--global--text--color--subtle)',
                          fontSize: '0.85rem',
                        }}
                      >
                        {spec.description}
                      </div>
                    )}
                  </FlexItem>
                  <FlexItem>
                    <Button
                      variant="plain"
                      aria-label={`Move ${rowTitle} up`}
                      isDisabled={index === 0}
                      onClick={() => move(index, -1)}
                      icon={<ArrowUpIcon />}
                    />
                    <Button
                      variant="plain"
                      aria-label={`Move ${rowTitle} down`}
                      isDisabled={index === draft.length - 1}
                      onClick={() => move(index, 1)}
                      icon={<ArrowDownIcon />}
                    />
                    {spec.templated && (
                      <Button
                        variant="plain"
                        aria-label={`Remove ${rowTitle}`}
                        onClick={() => remove(entry.instanceId)}
                        icon={<TrashIcon />}
                      />
                    )}
                  </FlexItem>
                </Flex>
              </li>
            )
          })}
        </ul>

        <div
          style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--pf-t--global--border--color--default)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Add a per-group widget
          </div>
          {groups.length === 0 ? (
            <div
              style={{
                color: 'var(--pf-t--global--text--color--subtle)',
                fontSize: '0.85rem',
              }}
            >
              No groups available. Create a group on the Groups page first.
            </div>
          ) : (
            <Flex
              alignItems={{ default: 'alignItemsCenter' }}
              spaceItems={{ default: 'spaceItemsSm' }}
            >
              <FlexItem>
                <FormSelect
                  aria-label="Widget type"
                  value={addWidgetId}
                  onChange={(_, v) => setAddWidgetId(v as WidgetId)}
                  style={{ minWidth: '14rem' }}
                >
                  {GROUP_TEMPLATES.map((w) => (
                    <FormSelectOption key={w.id} value={w.id} label={w.title} />
                  ))}
                </FormSelect>
              </FlexItem>
              <FlexItem>
                <FormSelect
                  aria-label="Group"
                  value={addGroupId}
                  onChange={(_, v) => setAddGroupId(v)}
                  style={{ minWidth: '12rem' }}
                >
                  {groups.map((g) => (
                    <FormSelectOption key={g.id} value={g.id} label={g.name} />
                  ))}
                </FormSelect>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" onClick={addInstance}>
                  Add
                </Button>
              </FlexItem>
            </Flex>
          )}
        </div>

        <div
          style={{
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--pf-t--global--border--color--default)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Add a blank card
          </div>
          <div
            style={{
              color: 'var(--pf-t--global--text--color--subtle)',
              fontSize: '0.85rem',
              marginBottom: '0.5rem',
            }}
          >
            Insert an empty card to keep the grid symmetric.
          </div>
          <Flex spaceItems={{ default: 'spaceItemsSm' }}>
            {BLANK_WIDGET_IDS.map((id) => {
              const spec = WIDGETS_BY_ID.get(id)
              if (!spec) return null
              const sizeLabel =
                id === 'blank-s' ? 'S' : id === 'blank-m' ? 'M' : 'L'
              return (
                <FlexItem key={id}>
                  <Button
                    variant="secondary"
                    onClick={() => addBlank(id)}
                    aria-label={`Add blank ${sizeLabel} card`}
                  >
                    Add {sizeLabel}
                  </Button>
                </FlexItem>
              )
            })}
          </Flex>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={apply}>
          Apply
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="link" onClick={reset}>
          Reset to defaults
        </Button>
      </ModalFooter>
    </Modal>
  )
}
