// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  ApiError,
  createSystem,
  deleteSystem,
  listSystems,
  type System,
  type SystemStatus,
} from '../api/systems'
import { useEventStream } from '../hooks/useEventStream'

const STATUS_LABELS: Record<
  SystemStatus,
  { color: 'green' | 'red' | 'grey'; text: string }
> = {
  reachable: { color: 'green', text: 'Reachable' },
  unreachable: { color: 'red', text: 'Unreachable' },
  unprobed: { color: 'grey', text: 'Unprobed' },
}

function formatLastSeen(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function SystemsPage() {
  const [systems, setSystems] = useState<System[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await listSystems()
      setSystems(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Debounced re-fetch on server events. Bursts (e.g. several systems
  // added in quick succession) collapse into one refetch.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEventStream(
    useCallback(
      (event) => {
        if (event.type !== 'systems.changed') return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          void refresh()
        }, 200)
      },
      [refresh],
    ),
  )
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const onDelete = async (id: string) => {
    try {
      await deleteSystem(id)
      await refresh()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <PageSection>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Title headingLevel="h1">Systems</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                Add system
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      <PageSection>
        {loadError && (
          <Alert variant="danger" title="Could not load systems" isInline>
            {loadError}
          </Alert>
        )}
        {!loadError && systems === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {systems !== null && systems.length === 0 && (
          <EmptyState titleText="No systems yet" headingLevel="h2">
            <EmptyStateBody>
              Add your first system with the button in the toolbar above.
            </EmptyStateBody>
          </EmptyState>
        )}
        {systems !== null && systems.length > 0 && (
          <Table aria-label="Systems" variant="compact">
            <Thead>
              <Tr>
                <Th width={25}>Name</Th>
                <Th width={25}>Hostname</Th>
                <Th width={15}>Status</Th>
                <Th width={20}>Last seen</Th>
                <Th width={10}>Added</Th>
                <Th width={10} screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {systems.map((s) => {
                const label = STATUS_LABELS[s.status] ?? STATUS_LABELS.unprobed
                return (
                  <Tr key={s.id}>
                    <Td dataLabel="Name" modifier="truncate">
                      {s.name}
                    </Td>
                    <Td dataLabel="Hostname" modifier="truncate">
                      {s.hostname}
                    </Td>
                    <Td dataLabel="Status">
                      <Label color={label.color} isCompact>
                        {label.text}
                      </Label>
                    </Td>
                    <Td dataLabel="Last seen">{formatLastSeen(s.lastSeen)}</Td>
                    <Td dataLabel="Added">
                      {new Date(s.createdAt).toLocaleString()}
                    </Td>
                    <Td dataLabel="Actions" isActionCell>
                      <Button
                        variant="link"
                        isDanger
                        onClick={() => void onDelete(s.id)}
                        aria-label={`Remove ${s.name}`}
                      >
                        Remove
                      </Button>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>

      <AddSystemModal
        isOpen={isAddOpen}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false)
          await refresh()
        }}
      />
    </>
  )
}

type AddSystemModalProps = {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function AddSystemModal({ isOpen, onClose, onCreated }: AddSystemModalProps) {
  const [hostname, setHostname] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset state every time the modal is opened so old values don't leak in.
  useEffect(() => {
    if (isOpen) {
      setHostname('')
      setName('')
      setNameEdited(false)
      setSubmitError(null)
      setSubmitting(false)
    }
  }, [isOpen])

  const onHostnameChange = (v: string) => {
    setHostname(v)
    if (!nameEdited) setName(v)
  }

  const onNameChange = (v: string) => {
    setName(v)
    setNameEdited(true)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createSystem({ name, hostname })
      await onCreated()
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      setSubmitError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="add-system-title"
    >
      <ModalHeader title="Add system" labelId="add-system-title" />
      <ModalBody>
        <Form id="add-system-form" onSubmit={onSubmit}>
          <FormGroup label="Hostname" fieldId="add-system-hostname" isRequired>
            <TextInput
              id="add-system-hostname"
              value={hostname}
              onChange={(_, v) => onHostnameChange(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
              placeholder="server.example.com or 10.0.0.5"
            />
          </FormGroup>
          <FormGroup label="Name" fieldId="add-system-name" isRequired>
            <TextInput
              id="add-system-name"
              value={name}
              onChange={(_, v) => onNameChange(v)}
              isRequired
              isDisabled={submitting}
              placeholder="Defaults to hostname"
            />
          </FormGroup>
          {submitError && (
            <Alert variant="danger" title="Could not add system" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="add-system-form"
          variant="primary"
          isLoading={submitting}
          isDisabled={submitting || !hostname || !name}
        >
          Add
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={submitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
