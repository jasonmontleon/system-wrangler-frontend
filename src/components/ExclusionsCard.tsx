// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Stack,
  StackItem,
  TextInput,
  Title,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import type { Exclusion, ExclusionInput } from '../api/exclusions'
import type { UpdaterDefinition } from '../api/updaters'

// ExclusionsCard renders the per-scope exclusion CRUD widget. It is
// scope-agnostic: the page wires the right list/create/delete pair
// against its own scope and passes the updater menu options pulled
// from /api/admin/updater-definitions. `*` (every updater) is added
// to the menu separately so it shows up even when the caller doesn't
// pre-include it.
//
// Reused by AdminExclusionsPage (global), GroupDetailPage (group tab),
// and SystemDetailPage (system card).
export type ExclusionsCardProps = {
  title: string
  description: string
  rows: Exclusion[] | null
  loadError?: string
  loading: boolean
  canManage: boolean
  updaters: UpdaterDefinition[]
  onCreate: (input: ExclusionInput) => Promise<void>
  onDelete: (row: Exclusion) => Promise<void>
}

export default function ExclusionsCard({
  title,
  description,
  rows,
  loadError,
  loading,
  canManage,
  updaters,
  onCreate,
  onDelete,
}: ExclusionsCardProps) {
  const [showForm, setShowForm] = useState(false)
  const [updater, setUpdater] = useState('')
  const [pattern, setPattern] = useState('')
  const [reason, setReason] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Exclusion | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filter the dropdown to updaters whose apply.yml actually honours
  // the var. The backend marks builtins individually and treats every
  // custom updater as supported (operator trust). `*` is always
  // available because it's a fleet-wide pin valid even when no single
  // updater honours it.
  const updaterChoices = useMemo(
    () => ['*', ...updaters.filter((u) => u.supportsExclusions).map((u) => u.id)],
    [updaters],
  )
  // Seed the dropdown with '*' on first open so the operator sees a
  // valid selection before they touch the menu.
  useEffect(() => {
    if (showForm && updater === '') {
      setUpdater(updaterChoices[0] ?? '*')
    }
  }, [showForm, updater, updaterChoices])

  const reset = useCallback(() => {
    setUpdater('')
    setPattern('')
    setReason('')
    setSubmitError(null)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (updater.trim() === '' || pattern.trim() === '') {
      setSubmitError('updater and pattern are required')
      return
    }
    setSubmitting(true)
    try {
      await onCreate({
        updater: updater.trim(),
        pattern: pattern.trim(),
        reason: reason.trim() === '' ? undefined : reason.trim(),
      })
      setShowForm(false)
      reset()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(confirmDelete)
      setConfirmDelete(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardTitle>
        <Stack hasGutter>
          <StackItem>
            <Title headingLevel="h2" size="lg">
              {title}
            </Title>
          </StackItem>
          <StackItem>
            <span style={{ fontWeight: 400 }}>{description}</span>
          </StackItem>
        </Stack>
      </CardTitle>
      <CardBody>
        <Stack hasGutter>
          {loadError && (
            <StackItem>
              <Alert variant="danger" title="Failed to load exclusions" isInline>
                {loadError}
              </Alert>
            </StackItem>
          )}
          {canManage && (
            <StackItem>
              <Button
                variant="primary"
                onClick={() => {
                  setShowForm(true)
                  reset()
                }}
              >
                Add exclusion
              </Button>
            </StackItem>
          )}
          <StackItem>
            {loading ? (
              <Spinner aria-label="Loading exclusions" />
            ) : !rows || rows.length === 0 ? (
              <em>No exclusions defined.</em>
            ) : (
              <Table aria-label="Exclusions" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Updater</Th>
                    <Th>Pattern</Th>
                    <Th>Reason</Th>
                    <Th>Created</Th>
                    {canManage && <Th aria-label="Actions" />}
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((r) => (
                    <Tr key={r.id}>
                      <Td dataLabel="Updater">{r.updater}</Td>
                      <Td dataLabel="Pattern">
                        <code>{r.pattern}</code>
                      </Td>
                      <Td dataLabel="Reason">{r.reason || '—'}</Td>
                      <Td dataLabel="Created">
                        {new Date(r.createdAt).toLocaleString()}
                      </Td>
                      {canManage && (
                        <Td dataLabel="Actions" isActionCell>
                          <Button
                            variant="link"
                            isDanger
                            onClick={() => {
                              setConfirmDelete(r)
                              setDeleteError(null)
                            }}
                          >
                            Remove
                          </Button>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </StackItem>
        </Stack>
      </CardBody>

      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false)
          reset()
        }}
        variant="small"
        aria-labelledby="exclusion-form-title"
      >
        <ModalHeader title="Add exclusion" labelId="exclusion-form-title" />
        <ModalBody>
          <Form id="exclusion-form" onSubmit={submit}>
            <Alert
              variant="info"
              isInline
              isPlain
              title="Hold-based managers take ownership"
            >
              <HelperText>
                <HelperTextItem>
                  apt, brew, snap, flatpak, xbps, and scoop honour exclusions by
                  flipping a host-side hold. The first Apply runs the manager's
                  hold command for matching patterns — including ones an
                  operator may have already set via SSH — and removing the
                  exclusion row will clear that hold on the next Apply.
                </HelperTextItem>
              </HelperText>
            </Alert>
            <FormGroup label="Updater" fieldId="exclusion-updater" isRequired>
              <FormSelect
                id="exclusion-updater"
                value={updater}
                onChange={(_e, v) => setUpdater(v)}
                aria-label="Updater"
              >
                {updaterChoices.map((id) => (
                  <FormSelectOption
                    key={id}
                    value={id}
                    label={id === '*' ? '* (every updater)' : id}
                  />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="Pattern" fieldId="exclusion-pattern" isRequired>
              <TextInput
                id="exclusion-pattern"
                value={pattern}
                onChange={(_e, v) => setPattern(v)}
                aria-label="Pattern"
                placeholder="e.g. kernel* or nginx"
              />
            </FormGroup>
            <FormGroup label="Reason (optional)" fieldId="exclusion-reason">
              <TextInput
                id="exclusion-reason"
                value={reason}
                onChange={(_e, v) => setReason(v)}
                aria-label="Reason"
              />
            </FormGroup>
            {submitError && (
              <Alert variant="danger" title="Create failed" isInline>
                {submitError}
              </Alert>
            )}
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            form="exclusion-form"
            type="submit"
            isDisabled={submitting}
            isLoading={submitting}
          >
            Add
          </Button>
          <Button
            variant="link"
            onClick={() => {
              setShowForm(false)
              reset()
            }}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        variant="small"
        aria-labelledby="exclusion-delete-title"
      >
        <ModalHeader
          title="Remove exclusion?"
          labelId="exclusion-delete-title"
        />
        <ModalBody>
          {confirmDelete && (
            <Stack hasGutter>
              <StackItem>
                Remove <code>{confirmDelete.pattern}</code> from{' '}
                <strong>{confirmDelete.updater}</strong>? Future updates will
                stop skipping this package at this scope.
              </StackItem>
              {deleteError && (
                <StackItem>
                  <Alert variant="danger" title="Delete failed" isInline>
                    {deleteError}
                  </Alert>
                </StackItem>
              )}
            </Stack>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={doDelete}
            isDisabled={deleting}
            isLoading={deleting}
          >
            Remove
          </Button>
          <Button variant="link" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  )
}
