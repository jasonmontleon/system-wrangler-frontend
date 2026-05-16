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

  it('renders the run_history_limit value from /api/admin/settings', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ settings: { run_history_limit: '250' } }),
    )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    expect(input.value).toBe('250')
  })

  it('PUTs the new value on Save and shows the success alert', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ settings: { run_history_limit: '100' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ settings: { run_history_limit: '500' } }),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

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

  it('surfaces a 400 error from the backend without losing the input', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ settings: { run_history_limit: '100' } }),
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
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    expect(
      await screen.findByText(/must be between 1 and 10000/i),
    ).toBeInTheDocument()
    expect(input.value).toBe('0')
  })

  it('shows a load error if /api/admin/settings fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<SettingsPage />)
    expect(
      await screen.findByText(/Failed to load settings/i),
    ).toBeInTheDocument()
  })
})
