// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
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
  createExporterDefinition,
  deleteExporterDefinition,
  listExporterDefinitions,
  updateExporterDefinition,
  type ExporterDefinition,
  type ExporterDefinitionInput,
  type ExporterKind,
} from '../api/exporters'
import { ApiError } from '../api/systems'

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; definitions: ExporterDefinition[] }
  | { kind: 'error'; message: string }

type EditorState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; original: ExporterDefinition }
  | { kind: 'view'; original: ExporterDefinition }

// ExportersPage is the Administration → Exporters page.
// Lists every registered installer (builtins + custom); the
// create/edit form only operates on custom rows because builtins
// are code-registered.
//
// Global Admin only — the route in App.tsx redirects everyone else.
export default function ExportersPage() {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' })
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setState({ kind: 'loading' })
    listExporterDefinitions()
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

  const onDelete = async (d: ExporterDefinition) => {
    setPageError(null)
    setDeleting(d.id)
    try {
      await deleteExporterDefinition(d.id)
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
          <Title headingLevel="h1">Exporters</Title>
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
            New custom installer
          </Button>
        </StackItem>
        <StackItem>
          {state.kind === 'loading' && (
            <Bullseye>
              <Spinner size="md" />
            </Bullseye>
          )}
          {state.kind === 'error' && (
            <Alert variant="danger" title="Failed to load installers" isInline>
              {state.message}
            </Alert>
          )}
          {state.kind === 'ready' && (
            <DefinitionsTable
              definitions={state.definitions}
              onEdit={(d) => setEditor({ kind: 'edit', original: d })}
              onView={(d) => setEditor({ kind: 'view', original: d })}
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
  onView,
  onDelete,
  deletingID,
}: {
  definitions: ExporterDefinition[]
  onEdit: (d: ExporterDefinition) => void
  onView: (d: ExporterDefinition) => void
  onDelete: (d: ExporterDefinition) => void
  deletingID: string | null
}) {
  if (definitions.length === 0) {
    return <p>No installers registered.</p>
  }
  return (
    <Table aria-label="Exporter installers" variant="compact">
      <Thead>
        <Tr>
          <Th>Display name</Th>
          <Th>ID</Th>
          <Th>Source</Th>
          <Th>Pkg manager</Th>
          <Th>Kind</Th>
          <Th>Port</Th>
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
              <code>{d.appliesToPkgManager}</code>
            </Td>
            <Td>{d.exporterKind}</Td>
            <Td>{d.bindPort}</Td>
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
                <Button variant="link" onClick={() => onView(d)}>
                  View
                </Button>
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
  const isView = state.kind === 'view'
  const readOnly = isView
  const original =
    state.kind === 'edit' || state.kind === 'view' ? state.original : null
  const [form, setForm] = useState<ExporterDefinitionInput>({
    id: original?.id.replace(/^custom\./, '') ?? '',
    displayName: original?.displayName ?? '',
    description: original?.description ?? '',
    appliesToPkgManager: original?.appliesToPkgManager ?? '',
    exporterKind: (original?.exporterKind ?? 'node_exporter') as ExporterKind,
    bindPort: original?.bindPort ?? 9100,
    installPlaybook: original?.installPlaybook ?? '',
    statusPlaybook: original?.statusPlaybook ?? '',
    removePlaybook: original?.removePlaybook ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      if (isEdit && original) {
        await updateExporterDefinition(original.id, {
          displayName: form.displayName,
          description: form.description,
          appliesToPkgManager: form.appliesToPkgManager,
          exporterKind: form.exporterKind,
          bindPort: form.bindPort,
          installPlaybook: form.installPlaybook,
          statusPlaybook: form.statusPlaybook,
          removePlaybook: form.removePlaybook,
        })
      } else {
        await createExporterDefinition({ ...form })
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

  const title = isView
    ? `View ${original?.id}`
    : isEdit
      ? `Edit ${original?.id}`
      : 'New custom installer'

  return (
    <Modal isOpen onClose={onClose} variant="large">
      <ModalHeader title={title} />
      <ModalBody>
        <Form>
          {error && (
            <Alert variant="danger" title="Save failed" isInline>
              {error}
            </Alert>
          )}
          {!isEdit && !isView && (
            <FormGroup label="ID slug" isRequired fieldId="exp-id">
              <TextInput
                id="exp-id"
                value={form.id}
                onChange={(_e, value) => setForm({ ...form, id: value })}
                placeholder="e.g. node-exporter-jammy — server prepends custom."
              />
            </FormGroup>
          )}
          {isView && (
            <FormGroup label="ID" fieldId="exp-id-view">
              <TextInput
                id="exp-id-view"
                value={original?.id ?? ''}
                readOnlyVariant="default"
              />
            </FormGroup>
          )}
          <FormGroup label="Display name" isRequired={!readOnly} fieldId="exp-display">
            <TextInput
              id="exp-display"
              value={form.displayName}
              onChange={(_e, value) => setForm({ ...form, displayName: value })}
              readOnlyVariant={readOnly ? 'default' : undefined}
            />
          </FormGroup>
          <FormGroup label="Description" fieldId="exp-description">
            <TextInput
              id="exp-description"
              value={form.description}
              onChange={(_e, value) => setForm({ ...form, description: value })}
              readOnlyVariant={readOnly ? 'default' : undefined}
            />
          </FormGroup>
          <FormGroup label="Applies to pkg manager" isRequired={!readOnly} fieldId="exp-pkgm">
            <TextInput
              id="exp-pkgm"
              value={form.appliesToPkgManager}
              onChange={(_e, value) =>
                setForm({ ...form, appliesToPkgManager: value })
              }
              placeholder="builtin.dnf"
              readOnlyVariant={readOnly ? 'default' : undefined}
            />
          </FormGroup>
          <FormGroup label="Exporter kind" isRequired={!readOnly} fieldId="exp-kind">
            <FormSelect
              id="exp-kind"
              value={form.exporterKind}
              isDisabled={readOnly}
              onChange={(_e, value) =>
                setForm({ ...form, exporterKind: value as ExporterKind })
              }
            >
              <FormSelectOption value="node_exporter" label="node_exporter" />
              <FormSelectOption value="windows_exporter" label="windows_exporter" />
            </FormSelect>
          </FormGroup>
          <FormGroup label="Bind port" isRequired={!readOnly} fieldId="exp-port">
            <TextInput
              id="exp-port"
              type="number"
              value={String(form.bindPort)}
              onChange={(_e, value) =>
                setForm({ ...form, bindPort: Number(value) || 0 })
              }
              readOnlyVariant={readOnly ? 'default' : undefined}
            />
          </FormGroup>
          <FormGroup label="Install playbook (YAML)" isRequired={!readOnly} fieldId="exp-install">
            <TextArea
              id="exp-install"
              rows={8}
              value={form.installPlaybook}
              onChange={(_e, value) => setForm({ ...form, installPlaybook: value })}
              spellCheck={false}
              readOnlyVariant={readOnly ? 'default' : undefined}
            />
          </FormGroup>
          <FormGroup label="Status playbook (YAML)" isRequired={!readOnly} fieldId="exp-status">
            <TextArea
              id="exp-status"
              rows={6}
              value={form.statusPlaybook}
              onChange={(_e, value) => setForm({ ...form, statusPlaybook: value })}
              spellCheck={false}
              readOnlyVariant={readOnly ? 'default' : undefined}
            />
          </FormGroup>
          <FormGroup
            label="Remove playbook (YAML, optional)"
            fieldId="exp-remove"
          >
            <TextArea
              id="exp-remove"
              rows={6}
              value={form.removePlaybook}
              onChange={(_e, value) => setForm({ ...form, removePlaybook: value })}
              spellCheck={false}
              readOnlyVariant={readOnly ? 'default' : undefined}
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        {!readOnly && (
          <Button variant="primary" isDisabled={busy} onClick={onSubmit}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
          </Button>
        )}
        <Button variant="link" isDisabled={busy} onClick={onClose}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
