// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HostKeysPanel from './HostKeysPanel'
import type { HostKey } from '../api/hostkeys'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const pending: HostKey = {
  id: 'k1',
  systemId: 's1',
  state: 'pending',
  algorithm: 'ssh-ed25519',
  publicKey: 'AAAA',
  fingerprint: 'SHA256:abc',
  firstSeenAt: '2026-05-15T00:00:00Z',
}

const accepted: HostKey = {
  id: 'k2',
  systemId: 's1',
  state: 'accepted',
  algorithm: 'ssh-rsa',
  publicKey: 'BBBB',
  fingerprint: 'SHA256:def',
  firstSeenAt: '2026-05-14T00:00:00Z',
  acceptedAt: '2026-05-15T00:00:00Z',
  acceptedBy: 'admin',
}

describe('HostKeysPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the empty state when no keys are recorded', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hostKeys: [] }))
    render(<HostKeysPanel systemId="s1" />)
    expect(await screen.findByText(/No host keys recorded yet/i)).toBeInTheDocument()
  })

  it('renders pending and accepted rows with the right actions', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ hostKeys: [accepted, pending] }),
    )
    render(<HostKeysPanel systemId="s1" />)
    expect(await screen.findByText('SHA256:abc')).toBeInTheDocument()
    expect(screen.getByText('SHA256:def')).toBeInTheDocument()
    // Pending row exposes Accept + Reject; accepted row exposes Delete.
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('accepts a pending key and reloads', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [pending] }))
      .mockResolvedValueOnce(jsonResponse({ ...pending, state: 'accepted' }))
      .mockResolvedValueOnce(
        jsonResponse({ hostKeys: [{ ...pending, state: 'accepted' }] }),
      )
    render(<HostKeysPanel systemId="s1" />)
    await screen.findByText('SHA256:abc')
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() =>
      expect(
        (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).filter(
          (c) => c[1]?.method === 'POST',
        ),
      ).toHaveLength(1),
    )
    const acceptCall = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).find(
      (c) => c[1]?.method === 'POST',
    )
    expect(acceptCall![0]).toBe('/api/systems/s1/host-keys/accept')
    expect(acceptCall![1]!.body).toBe(
      '{"algorithm":"ssh-ed25519","fingerprint":"SHA256:abc"}',
    )
  })

  it('shows a refresh message and reloads on 409 stale-fingerprint', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [pending] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'stale' }, { status: 409 }))
      .mockResolvedValueOnce(
        jsonResponse({ hostKeys: [{ ...pending, fingerprint: 'SHA256:NEW' }] }),
      )
    render(<HostKeysPanel systemId="s1" />)
    await screen.findByText('SHA256:abc')
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    expect(
      await screen.findByText(/offered key changed since this banner loaded/i),
    ).toBeInTheDocument()
    // The panel reloaded after the 409.
    await screen.findByText('SHA256:NEW')
  })

  it('rejects a pending key', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [pending] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [] }))
    render(<HostKeysPanel systemId="s1" />)
    await screen.findByText('SHA256:abc')
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    await screen.findByText(/no host keys recorded yet/i)
    const deleteCall = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).find(
      (c) => c[1]?.method === 'DELETE',
    )
    expect(deleteCall![0]).toBe('/api/systems/s1/host-keys/k1')
  })

  it('deletes an accepted key', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [accepted] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [] }))
    render(<HostKeysPanel systemId="s1" />)
    await screen.findByText('SHA256:def')
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await screen.findByText(/no host keys recorded yet/i)
  })

  it('surfaces non-409 errors as a danger alert', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [pending] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    render(<HostKeysPanel systemId="s1" />)
    await screen.findByText('SHA256:abc')
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    expect(await screen.findByText(/Action failed/i)).toBeInTheDocument()
    expect(screen.getByText(/boom/i)).toBeInTheDocument()
  })

  it('captures host keys when the button is clicked', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [] }))
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [pending] }))
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [pending] }))
    render(<HostKeysPanel systemId="s1" />)
    await screen.findByText(/no host keys recorded yet/i)
    fireEvent.click(screen.getByRole('button', { name: /capture host keys now/i }))
    // After the scan POST + the subsequent list GET, the new
    // pending row is rendered.
    expect(await screen.findByText('SHA256:abc')).toBeInTheDocument()
    const scanCall = (fetchMock.mock.calls as Array<[string, RequestInit | undefined]>).find(
      (c) => c[1]?.method === 'POST' && c[0].endsWith('/host-keys/scan'),
    )
    expect(scanCall).toBeDefined()
  })

  it('surfaces scan errors as a danger alert', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ hostKeys: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'unreachable' }, { status: 502 }))
    render(<HostKeysPanel systemId="s1" />)
    await screen.findByText(/no host keys recorded yet/i)
    fireEvent.click(screen.getByRole('button', { name: /capture host keys now/i }))
    expect(await screen.findByText(/Action failed/i)).toBeInTheDocument()
    expect(screen.getByText(/unreachable/i)).toBeInTheDocument()
  })

  it('shows a success summary when at least one key is accepted', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hostKeys: [accepted] }))
    render(<HostKeysPanel systemId="s1" />)
    expect(
      await screen.findByText(/Host key trust established \(1 accepted\)/i),
    ).toBeInTheDocument()
  })

  it('shows a success summary with pending count when both states coexist', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ hostKeys: [accepted, pending] }),
    )
    render(<HostKeysPanel systemId="s1" />)
    expect(
      await screen.findByText(/Host key trust established \(1 accepted, 1 pending review\)/i),
    ).toBeInTheDocument()
  })

  it('shows a warning summary when only pending keys are present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hostKeys: [pending] }))
    render(<HostKeysPanel systemId="s1" />)
    expect(
      await screen.findByText(/Host keys await review \(1 pending\)/i),
    ).toBeInTheDocument()
  })

  it('renders a danger alert when the initial load fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 500 }))
    render(<HostKeysPanel systemId="s1" />)
    expect(
      await screen.findByText(/Could not load host keys/i),
    ).toBeInTheDocument()
  })
})
