// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react'
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
  createHost,
  deleteHost,
  listHosts,
  type Host,
  type HostStatus,
} from '../api/hosts'

const STATUS_LABELS: Record<
  HostStatus,
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

export default function HostsPage() {
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isAddOpen, setAddOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await listHosts()
      setHosts(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onDelete = async (id: string) => {
    try {
      await deleteHost(id)
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
              <Title headingLevel="h1">Hosts</Title>
            </ToolbarItem>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                Add host
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </PageSection>

      <PageSection>
        {loadError && (
          <Alert variant="danger" title="Could not load hosts" isInline>
            {loadError}
          </Alert>
        )}
        {!loadError && hosts === null && (
          <Bullseye>
            <Spinner />
          </Bullseye>
        )}
        {hosts !== null && hosts.length === 0 && (
          <EmptyState titleText="No hosts yet" headingLevel="h2">
            <EmptyStateBody>
              Add your first host with the button in the toolbar above.
            </EmptyStateBody>
          </EmptyState>
        )}
        {hosts !== null && hosts.length > 0 && (
          <Table aria-label="Hosts" variant="compact">
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
              {hosts.map((h) => {
                const label = STATUS_LABELS[h.status] ?? STATUS_LABELS.unprobed
                return (
                  <Tr key={h.id}>
                    <Td dataLabel="Name" modifier="truncate">
                      {h.name}
                    </Td>
                    <Td dataLabel="Hostname" modifier="truncate">
                      {h.hostname}
                    </Td>
                    <Td dataLabel="Status">
                      <Label color={label.color} isCompact>
                        {label.text}
                      </Label>
                    </Td>
                    <Td dataLabel="Last seen">{formatLastSeen(h.lastSeen)}</Td>
                    <Td dataLabel="Added">
                      {new Date(h.createdAt).toLocaleString()}
                    </Td>
                    <Td dataLabel="Actions" isActionCell>
                      <Button
                        variant="link"
                        isDanger
                        onClick={() => void onDelete(h.id)}
                        aria-label={`Remove ${h.name}`}
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

      <AddHostModal
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

type AddHostModalProps = {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function AddHostModal({ isOpen, onClose, onCreated }: AddHostModalProps) {
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
      await createHost({ name, hostname })
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
      aria-labelledby="add-host-title"
    >
      <ModalHeader title="Add host" labelId="add-host-title" />
      <ModalBody>
        <Form id="add-host-form" onSubmit={onSubmit}>
          <FormGroup label="Hostname" fieldId="host-hostname" isRequired>
            <TextInput
              id="host-hostname"
              value={hostname}
              onChange={(_, v) => onHostnameChange(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
              placeholder="server.example.com or 10.0.0.5"
            />
          </FormGroup>
          <FormGroup label="Name" fieldId="host-name" isRequired>
            <TextInput
              id="host-name"
              value={name}
              onChange={(_, v) => onNameChange(v)}
              isRequired
              isDisabled={submitting}
              placeholder="Defaults to hostname"
            />
          </FormGroup>
          {submitError && (
            <Alert variant="danger" title="Could not add host" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="add-host-form"
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
