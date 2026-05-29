// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TestConnectionCard from './TestConnectionCard'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('TestConnectionCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a primary button before the first click', () => {
    render(<TestConnectionCard systemId="s1" />)
    expect(
      screen.getByRole('button', { name: /Run `ansible -m ping`/i }),
    ).toBeInTheDocument()
  })

  it('shows the success alert on a pong response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'success',
        reason: 'pong',
        exitCode: 0,
        durationMs: 312,
      }),
    )
    render(<TestConnectionCard systemId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Run `ansible -m ping`/i }))
    expect(await screen.findByText(/Connection ok/i)).toBeInTheDocument()
    expect(screen.getByText(/pong/)).toBeInTheDocument()
    expect(screen.getByText(/312ms/)).toBeInTheDocument()
  })

  it('shows a danger alert on a failure status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'failure',
        reason: 'ansible exited 4',
        exitCode: 4,
        durationMs: 42,
      }),
    )
    render(<TestConnectionCard systemId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Run `ansible -m ping`/i }))
    expect(await screen.findByText(/Connection failed/i)).toBeInTheDocument()
    expect(screen.getByText(/ansible exited 4/)).toBeInTheDocument()
  })

  it('shows a warning alert on missing credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'missing_credentials',
        reason: 'no credentials resolve for this system',
        exitCode: 0,
        durationMs: 1,
      }),
    )
    render(<TestConnectionCard systemId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Run `ansible -m ping`/i }))
    expect(await screen.findByText(/Missing credentials/i)).toBeInTheDocument()
  })

  it('shows the host-key mismatch title on host_key_mismatch', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'host_key_mismatch',
        reason: 'host key changed',
        exitCode: 1,
        durationMs: 5,
      }),
    )
    render(<TestConnectionCard systemId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Run `ansible -m ping`/i }))
    expect(await screen.findByText(/Host key mismatch/i)).toBeInTheDocument()
  })

  it('shows the no-accepted-host-key title on no_accepted_host_key', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: 'no_accepted_host_key',
        reason: 'TOFU pending',
        exitCode: 1,
        durationMs: 5,
      }),
    )
    render(<TestConnectionCard systemId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Run `ansible -m ping`/i }))
    expect(await screen.findByText(/No accepted host key/i)).toBeInTheDocument()
  })

  it('surfaces server errors via a danger alert', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    render(<TestConnectionCard systemId="s1" />)
    fireEvent.click(screen.getByRole('button', { name: /Run `ansible -m ping`/i }))
    expect(await screen.findByText(/Test failed to run/i)).toBeInTheDocument()
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
})
