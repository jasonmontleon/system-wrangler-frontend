// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  TextArea,
  TextInput,
  Title,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  createUpdaterDefinition,
  deleteUpdaterDefinition,
  listUpdaterDefinitions,
  updateUpdaterDefinition,
  type UpdaterDefinition,
  type UpdaterDefinitionInput,
} from '../api/updaters'
import { ApiError } from '../api/systems'

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; definitions: UpdaterDefinition[] }
  | { kind: 'error'; message: string }

type EditorState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; original: UpdaterDefinition }

// UpdatersPage is the Administration → Updaters page. Lists every
// registered updater (builtins + custom); the create/edit form
// only operates on custom rows because builtins are code-registered.
//
// Global Admin only. The route in App.tsx redirects everyone else
// away — this page does not gate by scope on its own.
export default function UpdatersPage() {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' })
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setState({ kind: 'loading' })
    listUpdaterDefinitions()
      .then((definitions) => setState({ kind: 'ready', definitions }))
      .catch((err) =>
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onDelete = async (d: UpdaterDefinition) => {
    setPageError(null)
    setDeleting(d.id)
    try {
      await deleteUpdaterDefinition(d.id)
      refresh()
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1">Updaters</Title>
        </StackItem>
        {pageError && (
          <StackItem>
            <Alert variant="danger" title="Operation failed" isInline>
              {pageError}
            </Alert>
          </StackItem>
        )}
        <StackItem>
          <Button variant="primary" onClick={() => setEditor({ kind: 'create' })}>
            New custom updater
          </Button>
        </StackItem>
        <StackItem>
          {state.kind === 'loading' && (
            <Bullseye>
              <Spinner size="md" />
            </Bullseye>
          )}
          {state.kind === 'error' && (
            <Alert variant="danger" title="Failed to load updaters" isInline>
              {state.message}
            </Alert>
          )}
          {state.kind === 'ready' && (
            <DefinitionsTable
              definitions={state.definitions}
              onEdit={(d) => setEditor({ kind: 'edit', original: d })}
              onDelete={onDelete}
              deletingID={deleting}
            />
          )}
        </StackItem>
      </Stack>
      {editor.kind !== 'closed' && (
        <EditorModal
          state={editor}
          onClose={() => setEditor({ kind: 'closed' })}
          onSaved={() => {
            setEditor({ kind: 'closed' })
            refresh()
          }}
        />
      )}
    </PageSection>
  )
}

function DefinitionsTable({
  definitions,
  onEdit,
  onDelete,
  deletingID,
}: {
  definitions: UpdaterDefinition[]
  onEdit: (d: UpdaterDefinition) => void
  onDelete: (d: UpdaterDefinition) => void
  deletingID: string | null
}) {
  if (definitions.length === 0) {
    return <p>No updaters registered.</p>
  }
  return (
    <Table aria-label="Updater definitions" variant="compact">
      <Thead>
        <Tr>
          <Th>Display name</Th>
          <Th>ID</Th>
          <Th>Source</Th>
          <Th>Detect binary</Th>
          <Th>Actions</Th>
        </Tr>
      </Thead>
      <Tbody>
        {definitions.map((d) => (
          <Tr key={d.id}>
            <Td>{d.displayName}</Td>
            <Td>
              <code>{d.id}</code>
            </Td>
            <Td>{d.source}</Td>
            <Td>
              <code>{d.detectBinary}</code>
            </Td>
            <Td>
              {d.source === 'custom' ? (
                <>
                  <Button variant="link" onClick={() => onEdit(d)}>
                    Edit
                  </Button>{' '}
                  <Button
                    variant="link"
                    isDisabled={deletingID === d.id}
                    onClick={() => onDelete(d)}
                  >
                    {deletingID === d.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </>
              ) : (
                <em>builtin</em>
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  )
}

function EditorModal({
  state,
  onClose,
  onSaved,
}: {
  state: EditorState
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = state.kind === 'edit'
  const original = isEdit ? state.original : null
  const [form, setForm] = useState<UpdaterDefinitionInput>({
    id: original?.id.replace(/^custom\./, '') ?? '',
    displayName: original?.displayName ?? '',
    description: original?.description ?? '',
    detectBinary: original?.detectBinary ?? '',
    checkPlaybook: original?.checkPlaybook ?? '',
    applyPlaybook: original?.applyPlaybook ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (isEdit && original) {
        await updateUpdaterDefinition(original.id, {
          displayName: form.displayName,
          description: form.description,
          detectBinary: form.detectBinary,
          checkPlaybook: form.checkPlaybook,
          applyPlaybook: form.applyPlaybook,
        })
      } else {
        await createUpdaterDefinition(form)
      }
      onSaved()
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} variant="large">
      <ModalHeader title={isEdit ? `Edit ${original?.id}` : 'New custom updater'} />
      <ModalBody>
        <Form>
          {error && (
            <Alert variant="danger" title="Save failed" isInline>
              {error}
            </Alert>
          )}
          {!isEdit && (
            <FormGroup label="ID slug" isRequired fieldId="updater-id">
              <TextInput
                id="updater-id"
                value={form.id}
                onChange={(_e, value) => setForm({ ...form, id: value })}
                placeholder="e.g. dnf-fast — server prepends custom."
              />
            </FormGroup>
          )}
          <FormGroup label="Display name" isRequired fieldId="updater-display">
            <TextInput
              id="updater-display"
              value={form.displayName}
              onChange={(_e, value) => setForm({ ...form, displayName: value })}
            />
          </FormGroup>
          <FormGroup label="Description" fieldId="updater-description">
            <TextInput
              id="updater-description"
              value={form.description}
              onChange={(_e, value) => setForm({ ...form, description: value })}
            />
          </FormGroup>
          <FormGroup label="Detect binary" isRequired fieldId="updater-binary">
            <TextInput
              id="updater-binary"
              value={form.detectBinary}
              onChange={(_e, value) => setForm({ ...form, detectBinary: value })}
              placeholder="dnf"
            />
          </FormGroup>
          <FormGroup label="Check playbook (YAML)" isRequired fieldId="updater-check">
            <TextArea
              id="updater-check"
              rows={8}
              value={form.checkPlaybook}
              onChange={(_e, value) => setForm({ ...form, checkPlaybook: value })}
              spellCheck={false}
            />
          </FormGroup>
          <FormGroup label="Apply playbook (YAML)" isRequired fieldId="updater-apply">
            <TextArea
              id="updater-apply"
              rows={8}
              value={form.applyPlaybook}
              onChange={(_e, value) => setForm({ ...form, applyPlaybook: value })}
              spellCheck={false}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" isDisabled={busy} onClick={onSubmit}>
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </Button>
        <Button variant="link" isDisabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
