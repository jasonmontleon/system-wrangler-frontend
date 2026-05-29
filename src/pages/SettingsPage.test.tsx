// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SettingsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the run_history_limit and update_concurrency_limit values', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        settings: { run_history_limit: '250', update_concurrency_limit: '6' },
      }),
    )
    render(<SettingsPage />)
    const retention = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    expect(retention.value).toBe('250')
    const concurrency = (await screen.findByLabelText(
      /Simultaneous check \/ update runs/i,
    )) as HTMLInputElement
    expect(concurrency.value).toBe('6')
  })

  it('PUTs the new run_history_limit on Save and shows the success alert', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '500', update_concurrency_limit: '4' },
        }),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '500' } })
    // Two Save buttons render — the first belongs to the retention card.
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[0])

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put?.[0]).toBe('/api/admin/settings/run_history_limit')
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        value: '500',
      })
    })
    expect(await screen.findByText(/^Saved$/i)).toBeInTheDocument()
  })

  it('PUTs the new update_concurrency_limit on Save', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '8' },
        }),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Simultaneous check \/ update runs/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[1])

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put?.[0]).toBe('/api/admin/settings/update_concurrency_limit')
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        value: '8',
      })
    })
    expect(await screen.findByText(/^Saved$/i)).toBeInTheDocument()
  })

  it('surfaces a 400 error from the backend without losing the input', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'run_history_limit must be between 1 and 10000' },
          400,
        ),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[0])

    expect(
      await screen.findByText(/must be between 1 and 10000/i),
    ).toBeInTheDocument()
    expect(input.value).toBe('0')
  })

  it('surfaces a 400 error from update_concurrency_limit save', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'concurrency must be between 1 and 64' }, 400),
      )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Simultaneous check \/ update runs/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[1])
    expect(
      await screen.findByText(/concurrency must be between 1 and 64/i),
    ).toBeInTheDocument()
    expect(input.value).toBe('0')
  })

  it('resyncs the input when the parent passes a different value after save', async () => {
    // First load returns 100; user types 250; Save returns 204; the
    // refresh after save returns 500 (server normalized). The input
    // must reflect the server's authoritative value, not the user's
    // typed 250 — that's what the value-vs-input useEffect guards.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '500', update_concurrency_limit: '4' },
        }),
      )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '250' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[0])
    await waitFor(() => {
      expect(input.value).toBe('500')
    })
  })

  it('shows a load error if /api/admin/settings fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<SettingsPage />)
    expect(
      await screen.findByText(/Failed to load settings/i),
    ).toBeInTheDocument()
  })
})
