// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UpdatersPage from './UpdatersPage'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const builtin = {
  id: 'builtin.dnf',
  source: 'builtin' as const,
  displayName: 'dnf',
  description: '',
  detectBinary: 'dnf',
  checkPlaybook: '- hosts: all\n',
  applyPlaybook: '- hosts: all\n',
}

const custom = {
  id: 'custom.fast-dnf',
  source: 'custom' as const,
  displayName: 'fast-dnf',
  description: 'mine',
  detectBinary: 'dnf',
  checkPlaybook: '- hosts: all\n',
  applyPlaybook: '- hosts: all\n',
}

describe('UpdatersPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists builtins and custom updaters with edit only on custom rows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ definitions: [builtin, custom] }),
    )
    render(<UpdatersPage />)
    expect(await screen.findByText('custom.fast-dnf')).toBeInTheDocument()
    expect(screen.getByText('builtin.dnf')).toBeInTheDocument()
    // Only one Edit button — custom row.
    expect(screen.getAllByRole('button', { name: /^Edit$/i })).toHaveLength(1)
  })

  it('creates a new custom updater via the form modal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [builtin] }))
    render(<UpdatersPage />)
    fireEvent.click(await screen.findByRole('button', { name: /New custom updater/i }))
    // Modal renders the form fields. Use placeholder text to avoid
    // PatternFly's duplicate-label DOM that confuses findByLabelText.
    const idField = await screen.findByPlaceholderText(/server prepends custom/i)
    fireEvent.change(idField, { target: { value: 'beta' } })
    const textboxes = screen.getAllByRole('textbox')
    // Order: id slug, display, description, detect binary; textareas come after.
    fireEvent.change(textboxes[1], { target: { value: 'beta-name' } })
    fireEvent.change(textboxes[3], { target: { value: 'beta' } })
    const textareas = screen
      .getAllByRole('textbox')
      .filter((el) => el.tagName === 'TEXTAREA')
    fireEvent.change(textareas[0], { target: { value: '- hosts: all\n' } })
    fireEvent.change(textareas[1], { target: { value: '- hosts: all\n' } })
    // POST creates, then page reloads.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          id: 'custom.beta',
          source: 'custom',
          displayName: 'beta-name',
          description: '',
          detectBinary: 'beta',
          checkPlaybook: '- hosts: all\n',
          applyPlaybook: '- hosts: all\n',
        },
        { status: 201 },
      ),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        definitions: [
          builtin,
          { ...custom, id: 'custom.beta', displayName: 'beta-name' },
        ],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    await waitFor(() =>
      expect(screen.getByText('beta-name')).toBeInTheDocument(),
    )
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')
    expect(post?.[0]).toBe('/api/admin/updater-definitions')
  })

  it('surfaces a save error from the server', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [builtin] }))
    render(<UpdatersPage />)
    fireEvent.click(await screen.findByRole('button', { name: /New custom updater/i }))
    await screen.findByPlaceholderText(/server prepends custom/i)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'syntax check failed: bad yaml' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    expect(await screen.findByText(/syntax check failed/i)).toBeInTheDocument()
  })

  it('deletes a custom updater after confirmation', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ definitions: [builtin, custom] }),
    )
    render(<UpdatersPage />)
    await screen.findByText('custom.fast-dnf')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [builtin] }))
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(screen.queryByText('custom.fast-dnf')).toBeNull())
  })
})
