// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemCredentialsModal from './SystemCredentialsModal'
import type { System } from '../api/systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const sys: System = {
  id: 'host-1',
  name: 'host-1',
  hostname: 'h1.example',
  createdAt: '2026-05-15T00:00:00Z',
  status: 'reachable',
  groupId: null,
}

describe('SystemCredentialsModal', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function respond(opts: {
    slot?: unknown
    slotStatus?: number
    effective?: unknown
    effectiveStatus?: number
    hostKeys?: unknown
  }) {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/effective-credential')) {
        return Promise.resolve(
          jsonResponse(
            opts.effective ?? { error: 'none' },
            { status: opts.effectiveStatus ?? (opts.effective ? 200 : 404) },
          ),
        )
      }
      if (url.endsWith('/ansible-credential')) {
        return Promise.resolve(
          jsonResponse(
            opts.slot ?? { error: 'none' },
            { status: opts.slotStatus ?? (opts.slot ? 200 : 404) },
          ),
        )
      }
      // The modal now also embeds the HostKeysPanel; default
      // it to an empty list so the test-connection card stays
      // hidden unless the test explicitly seeds accepted keys.
      if (url.endsWith('/host-keys')) {
        return Promise.resolve(jsonResponse(opts.hostKeys ?? { hostKeys: [] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, { status: 500 }))
    })
  }

  it('shows the test connection card when both panels are ready', async () => {
    respond({
      effective: {
        ansibleUser: 'ansible',
        userSource: 'global',
        publicKey: 'ssh-ed25519 AAAA',
        keySource: 'global',
        keyOrigin: 'sw_generated',
      },
      hostKeys: {
        hostKeys: [
          {
            id: 'k1',
            systemId: 'host-1',
            state: 'accepted',
            algorithm: 'ssh-ed25519',
            publicKey: 'AAAA',
            fingerprint: 'SHA256:abc',
            firstSeenAt: '2026-05-15T00:00:00Z',
            acceptedAt: '2026-05-15T00:01:00Z',
          },
        ],
      },
    })
    render(<SystemCredentialsModal system={sys} isOpen={true} onClose={vi.fn()} />)
    expect(
      await screen.findByRole('button', { name: /Run `ansible -m ping`/i }),
    ).toBeInTheDocument()
  })

  it('hides the test connection card when no accepted host key exists', async () => {
    respond({
      effective: {
        ansibleUser: 'ansible',
        userSource: 'global',
        publicKey: 'ssh-ed25519 AAAA',
        keySource: 'global',
        keyOrigin: 'sw_generated',
      },
      // only a pending key — host keys panel reports not ready
      hostKeys: {
        hostKeys: [
          {
            id: 'k1',
            systemId: 'host-1',
            state: 'pending',
            algorithm: 'ssh-ed25519',
            publicKey: 'AAAA',
            fingerprint: 'SHA256:abc',
            firstSeenAt: '2026-05-15T00:00:00Z',
          },
        ],
      },
    })
    render(<SystemCredentialsModal system={sys} isOpen={true} onClose={vi.fn()} />)
    await screen.findByText(/Effective credential/i)
    expect(
      screen.queryByRole('button', { name: /Run `ansible -m ping`/i }),
    ).toBeNull()
  })

  it('renders the effective panel and editor when the system has resolved credentials', async () => {
    respond({
      effective: {
        ansibleUser: 'ansible',
        userSource: 'group',
        publicKey: 'ssh-ed25519 AAAA',
        keySource: 'global',
        keyOrigin: 'sw_generated',
      },
      slot: null,
      slotStatus: 404,
    })
    render(<SystemCredentialsModal system={sys} isOpen={true} onClose={vi.fn()} />)
    expect(await screen.findByText(/Effective credential/i)).toBeInTheDocument()
    expect(screen.getByText('ansible')).toBeInTheDocument()
    expect(screen.getByText(/from group/i)).toBeInTheDocument()
    expect(screen.getByText(/from global/i)).toBeInTheDocument()
    expect(screen.getByText('ssh-ed25519 AAAA')).toBeInTheDocument()
  })

  it('shows the no-credentials warning when the resolver returns 404', async () => {
    respond({ effectiveStatus: 404, slotStatus: 404 })
    render(<SystemCredentialsModal system={sys} isOpen={true} onClose={vi.fn()} />)
    expect(
      await screen.findByText(/No credentials resolve for this system/i),
    ).toBeInTheDocument()
  })

  it('surfaces the incomplete-flow message on 409', async () => {
    respond({
      effective: { error: 'credential is incomplete: configure both an ansible user and a key' },
      effectiveStatus: 409,
      slotStatus: 404,
    })
    render(<SystemCredentialsModal system={sys} isOpen={true} onClose={vi.fn()} />)
    expect((await screen.findAllByText(/Credential is incomplete/i)).length).toBeGreaterThan(0)
    expect(screen.getByText(/configure both/i)).toBeInTheDocument()
  })

  it('shows a danger alert on resolver 5xx', async () => {
    respond({
      effective: { error: 'boom' },
      effectiveStatus: 500,
      slotStatus: 404,
    })
    render(<SystemCredentialsModal system={sys} isOpen={true} onClose={vi.fn()} />)
    expect(
      await screen.findByText(/Could not resolve credential/i),
    ).toBeInTheDocument()
  })
})
