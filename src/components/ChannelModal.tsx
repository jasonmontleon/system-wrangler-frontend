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
  Select,
  SelectList,
  SelectOption,
  MenuToggle,
  type MenuToggleElement,
  TextArea,
  TextInput,
} from '@patternfly/react-core'
import {
  type ChannelConfig,
  type ChannelType,
  createChannel,
  type NotificationChannel,
  type NotificationChannelInput,
  updateChannel,
} from '../api/notifications'
import { ApiError } from '../api/systems'

type Props = {
  // 'new' opens the modal in create mode; a channel opens it in edit
  // mode prefilled; null keeps it closed.
  target: NotificationChannel | 'new' | null
  onClose: () => void
  onSaved: () => void
  // create/update default to the global (admin) channel endpoints; the
  // personal preferences card passes the /me variants to reuse this modal.
  create?: (input: NotificationChannelInput) => Promise<NotificationChannel>
  update?: (id: string, input: NotificationChannelInput) => Promise<NotificationChannel>
}

const TYPES: { value: ChannelType; label: string }[] = [
  { value: 'email', label: 'Email (SMTP)' },
  { value: 'slack', label: 'Slack' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'sms', label: 'SMS' },
]

const secretLabel: Record<ChannelType, string> = {
  email: 'SMTP password',
  slack: 'Slack webhook URL',
  webhook: 'Auth header value',
  sms: 'Auth token',
}

function toList(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export default function ChannelModal({ target, onClose, onSaved, create, update }: Props) {
  const createFn = create ?? createChannel
  const updateFn = update ?? updateChannel
  const isOpen = target !== null
  const editing = target !== 'new' && target !== null ? target : null

  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>('email')
  const [typeOpen, setTypeOpen] = useState(false)
  const [enabled, setEnabled] = useState(true)

  // email
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [username, setUsername] = useState('')
  const [startTLS, setStartTLS] = useState(true)
  const [skipVerify, setSkipVerify] = useState(false)
  // email + sms
  const [from, setFrom] = useState('')
  const [toText, setToText] = useState('')
  // webhook
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState('POST')
  const [methodOpen, setMethodOpen] = useState(false)
  const [headerName, setHeaderName] = useState('')
  // sms
  const [baseURL, setBaseURL] = useState('')
  const [accountSID, setAccountSID] = useState('')

  const [secret, setSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setSubmitting(false)
    setSubmitError(null)
    setSecret('')
    if (editing) {
      const c = editing.config
      setName(editing.name)
      setType(editing.type)
      setEnabled(editing.enabled)
      setSmtpHost(c.smtpHost ?? '')
      setSmtpPort(String(c.smtpPort ?? 587))
      setUsername(c.username ?? '')
      setStartTLS(c.startTLS ?? false)
      setSkipVerify(c.skipVerify ?? false)
      setFrom(c.from ?? '')
      setToText((c.to ?? []).join(', '))
      setUrl(c.url ?? '')
      setMethod(c.method ?? 'POST')
      setHeaderName(c.headerName ?? '')
      setBaseURL(c.baseURL ?? '')
      setAccountSID(c.accountSID ?? '')
    } else {
      setName('')
      setType('email')
      setEnabled(true)
      setSmtpHost('')
      setSmtpPort('587')
      setUsername('')
      setStartTLS(true)
      setSkipVerify(false)
      setFrom('')
      setToText('')
      setUrl('')
      setMethod('POST')
      setHeaderName('')
      setBaseURL('')
      setAccountSID('')
    }
  }, [isOpen, editing])

  if (!isOpen) return null

  const buildConfig = (): ChannelConfig => {
    switch (type) {
      case 'email':
        return {
          smtpHost,
          smtpPort: Number(smtpPort),
          username: username || undefined,
          startTLS,
          skipVerify,
          from,
          to: toList(toText),
        }
      case 'slack':
        return {}
      case 'webhook':
        return { url, method, headerName: headerName || undefined }
      case 'sms':
        return {
          baseURL: baseURL || undefined,
          accountSID,
          from,
          to: toList(toText),
        }
    }
  }

  const secretRequired =
    !editing && (type === 'slack' || type === 'sms')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    const input: NotificationChannelInput = {
      name,
      type,
      enabled,
      config: buildConfig(),
      secret: secret || undefined,
    }
    try {
      if (editing) {
        await updateFn(editing.id, input)
      } else {
        await createFn(input)
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

  const portValid = (() => {
    const n = Number(smtpPort)
    return Number.isInteger(n) && n >= 1 && n <= 65535
  })()

  const validForSubmit = (() => {
    if (!name.trim()) return false
    if (secretRequired && !secret.trim()) return false
    switch (type) {
      case 'email':
        return !!smtpHost.trim() && portValid && !!from.trim() && toList(toText).length > 0
      case 'slack':
        return true
      case 'webhook':
        return !!url.trim()
      case 'sms':
        return !!accountSID.trim() && !!from.trim() && toList(toText).length > 0
    }
  })()

  return (
    <Modal
      variant="medium"
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="channel-modal-title"
    >
      <ModalHeader
        title={editing ? `Edit channel: ${editing.name}` : 'New notification channel'}
        labelId="channel-modal-title"
      />
      <ModalBody>
        <Form id="channel-form" onSubmit={onSubmit}>
          <FormGroup label="Name" fieldId="channel-name" isRequired>
            <TextInput
              id="channel-name"
              value={name}
              onChange={(_, v) => setName(v)}
              isRequired
              isDisabled={submitting}
              autoFocus
            />
          </FormGroup>

          <FormGroup label="Type" fieldId="channel-type" isRequired>
            <Select
              id="channel-type"
              isOpen={typeOpen}
              onOpenChange={setTypeOpen}
              selected={type}
              onSelect={(_, v) => {
                setType(v as ChannelType)
                setTypeOpen(false)
              }}
              toggle={(ref: React.Ref<MenuToggleElement>) => (
                <MenuToggle
                  ref={ref}
                  isExpanded={typeOpen}
                  onClick={() => setTypeOpen((o) => !o)}
                  isDisabled={submitting || !!editing}
                >
                  {TYPES.find((t) => t.value === type)?.label}
                </MenuToggle>
              )}
            >
              <SelectList>
                {TYPES.map((t) => (
                  <SelectOption key={t.value} value={t.value}>
                    {t.label}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
            {editing && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>A channel's type can't be changed after creation.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>

          {type === 'email' && (
            <>
              <FormGroup label="SMTP host" fieldId="channel-smtp-host" isRequired>
                <TextInput id="channel-smtp-host" value={smtpHost} onChange={(_, v) => setSmtpHost(v)} isDisabled={submitting} />
              </FormGroup>
              <FormGroup label="SMTP port" fieldId="channel-smtp-port" isRequired>
                <TextInput
                  id="channel-smtp-port"
                  type="number"
                  value={smtpPort}
                  onChange={(_, v) => setSmtpPort(v)}
                  isDisabled={submitting}
                  validated={portValid ? 'default' : 'error'}
                />
              </FormGroup>
              <FormGroup label="Username" fieldId="channel-username">
                <TextInput id="channel-username" value={username} onChange={(_, v) => setUsername(v)} isDisabled={submitting} placeholder="Optional" />
              </FormGroup>
              <FormGroup label="From" fieldId="channel-from" isRequired>
                <TextInput id="channel-from" value={from} onChange={(_, v) => setFrom(v)} isDisabled={submitting} placeholder="alerts@example.com" />
              </FormGroup>
              <FormGroup label="Recipients" fieldId="channel-to" isRequired>
                <TextArea
                  id="channel-to"
                  aria-label="Email recipients"
                  value={toText}
                  onChange={(_, v) => setToText(v)}
                  isDisabled={submitting}
                  placeholder="oncall@example.com, sre@example.com"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>Comma- or newline-separated addresses.</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup fieldId="channel-starttls">
                <Checkbox id="channel-starttls" label="Use STARTTLS" isChecked={startTLS} onChange={(_, v) => setStartTLS(v)} isDisabled={submitting} />
                <Checkbox id="channel-skipverify" label="Skip TLS certificate verification (self-signed relays)" isChecked={skipVerify} onChange={(_, v) => setSkipVerify(v)} isDisabled={submitting} />
              </FormGroup>
            </>
          )}

          {type === 'webhook' && (
            <>
              <FormGroup label="URL" fieldId="channel-url" isRequired>
                <TextInput id="channel-url" value={url} onChange={(_, v) => setUrl(v)} isDisabled={submitting} placeholder="https://example.com/hook" />
              </FormGroup>
              <FormGroup label="Method" fieldId="channel-method">
                <Select
                  id="channel-method"
                  isOpen={methodOpen}
                  onOpenChange={setMethodOpen}
                  selected={method}
                  onSelect={(_, v) => {
                    setMethod(v as string)
                    setMethodOpen(false)
                  }}
                  toggle={(ref: React.Ref<MenuToggleElement>) => (
                    <MenuToggle ref={ref} isExpanded={methodOpen} onClick={() => setMethodOpen((o) => !o)} isDisabled={submitting}>
                      {method}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    <SelectOption value="POST">POST</SelectOption>
                    <SelectOption value="PUT">PUT</SelectOption>
                  </SelectList>
                </Select>
              </FormGroup>
              <FormGroup label="Auth header name" fieldId="channel-header-name">
                <TextInput id="channel-header-name" value={headerName} onChange={(_, v) => setHeaderName(v)} isDisabled={submitting} placeholder="Authorization (optional)" />
              </FormGroup>
            </>
          )}

          {type === 'sms' && (
            <>
              <FormGroup label="Provider base URL" fieldId="channel-base-url">
                <TextInput id="channel-base-url" value={baseURL} onChange={(_, v) => setBaseURL(v)} isDisabled={submitting} placeholder="https://api.twilio.com/2010-04-01 (default)" />
              </FormGroup>
              <FormGroup label="Account SID" fieldId="channel-sid" isRequired>
                <TextInput id="channel-sid" value={accountSID} onChange={(_, v) => setAccountSID(v)} isDisabled={submitting} />
              </FormGroup>
              <FormGroup label="From number" fieldId="channel-from-sms" isRequired>
                <TextInput id="channel-from-sms" value={from} onChange={(_, v) => setFrom(v)} isDisabled={submitting} placeholder="+15550000000" />
              </FormGroup>
              <FormGroup label="Recipient numbers" fieldId="channel-to-sms" isRequired>
                <TextArea
                  id="channel-to-sms"
                  aria-label="SMS recipients"
                  value={toText}
                  onChange={(_, v) => setToText(v)}
                  isDisabled={submitting}
                  placeholder="+15551112222, +15553334444"
                />
              </FormGroup>
            </>
          )}

          <FormGroup label={secretLabel[type]} fieldId="channel-secret" isRequired={secretRequired}>
            <TextInput
              id="channel-secret"
              type="password"
              value={secret}
              onChange={(_, v) => setSecret(v)}
              isDisabled={submitting}
              placeholder={editing && editing.hasSecret ? 'Leave blank to keep the stored value' : ''}
            />
          </FormGroup>

          <FormGroup fieldId="channel-enabled">
            <Checkbox id="channel-enabled" label="Enabled" isChecked={enabled} onChange={(_, v) => setEnabled(v)} isDisabled={submitting} />
          </FormGroup>

          {submitError && (
            <Alert variant="danger" title="Could not save channel" isInline>
              {submitError}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form="channel-form"
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
