// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CredentialSlotEditor from './CredentialSlotEditor'
import type { CredentialSlot, CredentialUpsert } from '../api/credentials'

function slot(over: Partial<CredentialSlot> = {}): CredentialSlot {
  return {
    scopeKind: 'global',
    ansibleUser: 'ansible',
    publicKey: 'ssh-ed25519 AAAA',
    origin: 'sw_generated',
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T00:00:00Z',
    ...over,
  }
}

describe('CredentialSlotEditor', () => {
  it('renders the empty-state alert when no slot exists', async () => {
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(null)}
        save={vi.fn()}
        scopeLabel="global default"
      />,
    )
    expect(await screen.findByText(/no slot configured/i)).toBeInTheDocument()
    expect(screen.getByText(/ansible credentials — global default/i)).toBeInTheDocument()
  })

  it('shows the public key in a copyable element when a slot has one', async () => {
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot())}
        save={vi.fn()}
        scopeLabel="global default"
      />,
    )
    expect(await screen.findByText(/Ansible user: ansible/i)).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519 AAAA')).toBeInTheDocument()
    expect(screen.getByText(/key: sw-generated/i)).toBeInTheDocument()
  })

  it('saves only the ansible user when the key field is left as Inherit', async () => {
    const save = vi.fn().mockImplementation((input: CredentialUpsert) =>
      Promise.resolve(slot({ ansibleUser: input.ansibleUser ?? 'ansible' })),
    )
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot())}
        save={save}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/Ansible user: ansible/i)
    fireEvent.change(screen.getByLabelText('Ansible user'), {
      target: { value: 'deploy' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toEqual({ ansibleUser: 'deploy' })
  })

  it('sends sw_generated when the key action is Generate', async () => {
    const save = vi.fn().mockResolvedValue(slot())
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(null)}
        save={save}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/no slot configured/i)
    fireEvent.change(screen.getByLabelText('Ansible user'), { target: { value: 'u' } })
    fireEvent.change(screen.getByLabelText('Key action'), { target: { value: 'generate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toEqual({
      ansibleUser: 'u',
      key: { origin: 'sw_generated' },
    })
  })

  it('requires a PEM when paste mode is selected', async () => {
    const save = vi.fn()
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot({ publicKey: undefined, origin: undefined }))}
        save={save}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/Ansible user: ansible/i)
    fireEvent.change(screen.getByLabelText('Key action'), { target: { value: 'paste' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).not.toHaveBeenCalled()
    expect(await screen.findByText(/Paste a private key/i)).toBeInTheDocument()
  })

  it('sends user_supplied when a PEM is pasted', async () => {
    const save = vi.fn().mockResolvedValue(slot({ origin: 'user_supplied' }))
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot({ publicKey: undefined, origin: undefined }))}
        save={save}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/Ansible user: ansible/i)
    fireEvent.change(screen.getByLabelText('Key action'), { target: { value: 'paste' } })
    fireEvent.change(screen.getByLabelText('Private key PEM'), {
      target: { value: '-----BEGIN OPENSSH PRIVATE KEY-----\nbody\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0].key.origin).toBe('user_supplied')
    expect(save.mock.calls[0][0].key.privateKeyPem).toContain('BEGIN OPENSSH')
  })

  it('shows the clear-key option only when a key is currently set', async () => {
    const { rerender } = render(
      <CredentialSlotEditor
        load={() => Promise.resolve(null)}
        save={vi.fn()}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/no slot configured/i)
    const select1 = screen.getByLabelText('Key action') as HTMLSelectElement
    const opts1 = Array.from(select1.options).map((o) => o.value)
    expect(opts1).not.toContain('clear')

    rerender(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot())}
        save={vi.fn()}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/Ansible user: ansible/i)
    const select2 = screen.getByLabelText('Key action') as HTMLSelectElement
    const opts2 = Array.from(select2.options).map((o) => o.value)
    expect(opts2).toContain('clear')
  })

  it('refuses save when no fields changed', async () => {
    const save = vi.fn()
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot())}
        save={save}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/Ansible user: ansible/i)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).not.toHaveBeenCalled()
    expect(await screen.findByText(/Nothing to save/i)).toBeInTheDocument()
  })

  it('surfaces save errors', async () => {
    const save = vi.fn().mockRejectedValue(new Error('boom'))
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(null)}
        save={save}
        scopeLabel="global default"
      />,
    )
    await screen.findByText(/no slot configured/i)
    fireEvent.change(screen.getByLabelText('Ansible user'), { target: { value: 'u' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Save failed/i)).toBeInTheDocument()
    expect(screen.getByText(/boom/i)).toBeInTheDocument()
  })

  it('invokes remove when the danger button is clicked', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot())}
        save={vi.fn()}
        remove={remove}
        scopeLabel="group prod"
      />,
    )
    await screen.findByText(/Ansible user: ansible/i)
    fireEvent.click(screen.getByRole('button', { name: /remove slot/i }))
    await waitFor(() => expect(remove).toHaveBeenCalled())
    expect(await screen.findByText(/no slot configured/i)).toBeInTheDocument()
  })

  it('shows an error alert when the initial load fails', async () => {
    render(
      <CredentialSlotEditor
        load={() => Promise.reject(new Error('network down'))}
        save={vi.fn()}
        scopeLabel="global default"
      />,
    )
    expect(await screen.findByText(/Could not load credentials/i)).toBeInTheDocument()
  })

  it('clears the key without supplying a new one', async () => {
    const save = vi.fn().mockResolvedValue(slot({ publicKey: undefined, origin: undefined }))
    render(
      <CredentialSlotEditor
        load={() => Promise.resolve(slot())}
        save={save}
        scopeLabel="group prod"
      />,
    )
    await screen.findByText(/Ansible user: ansible/i)
    fireEvent.change(screen.getByLabelText('Key action'), { target: { value: 'clear' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toEqual({ clearKey: true })
  })
})
