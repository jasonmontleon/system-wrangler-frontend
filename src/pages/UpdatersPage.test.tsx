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
    // Builtin rows expose a View button instead of Edit/Delete.
    expect(screen.getAllByRole('button', { name: /^View$/i })).toHaveLength(1)
  })

  it('opens the builtin updater in a read-only modal via View', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [builtin] }))
    render(<UpdatersPage />)
    await screen.findByText('builtin.dnf')
    fireEvent.click(screen.getByRole('button', { name: /^View$/i }))
    expect(
      await screen.findByRole('heading', { name: /View builtin\.dnf/i }),
    ).toBeInTheDocument()
    // No Save/Create button — only Close.
    expect(
      screen.queryByRole('button', { name: /^Save|^Create|^Save changes$/i }),
    ).toBeNull()
    // Every text input/textarea is read-only.
    const textboxes = screen.getAllByRole('textbox')
    for (const el of textboxes) {
      expect(el).toHaveAttribute('readonly')
    }
    // Click the footer Close link (the one visible as text, not the
    // modal's aria-only "Close" icon button).
    const closeFooter = screen
      .getAllByRole('button', { name: /^Close$/i })
      .find((b) => b.textContent?.trim() === 'Close')
    expect(closeFooter).toBeTruthy()
    fireEvent.click(closeFooter!)
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: /View builtin\.dnf/i }),
      ).toBeNull(),
    )
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

  it('renders the load error when the list call fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    render(<UpdatersPage />)
    expect(await screen.findByText(/Failed to load updaters/i)).toBeInTheDocument()
  })

  it('renders the empty list message when no updaters are registered', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [] }))
    render(<UpdatersPage />)
    expect(await screen.findByText(/No updaters registered/i)).toBeInTheDocument()
  })

  it('edits an existing custom updater through the modal', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ definitions: [custom] }))
      .mockResolvedValueOnce(jsonResponse({ ...custom, displayName: 'fast-dnf v2' }))
      .mockResolvedValueOnce(jsonResponse({ definitions: [{ ...custom, displayName: 'fast-dnf v2' }] }))
    render(<UpdatersPage />)
    await screen.findByText('custom.fast-dnf')
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }))
    const dialog = await screen.findByRole('dialog')
    const display = dialog.querySelector('#updater-display') as HTMLInputElement
    fireEvent.change(display, { target: { value: 'fast-dnf v2' } })
    const desc = dialog.querySelector('#updater-description') as HTMLInputElement
    fireEvent.change(desc, { target: { value: 'mine v2' } })
    const checkOnly = dialog.querySelector('#updater-check-only') as HTMLInputElement
    fireEvent.click(checkOnly)
    const save = screen
      .getAllByRole('button', { name: /^Save changes$/i })[0]
    fireEvent.click(save)
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]).endsWith('/api/admin/updater-definitions/custom.fast-dnf') &&
          (c[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
    })
  })

  it('surfaces a delete error from the API', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ definitions: [custom] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'in use' }, { status: 409 }))
    render(<UpdatersPage />)
    await screen.findByText('custom.fast-dnf')
    // Delete fires immediately on click (no confirm modal).
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }))
    expect(await screen.findByText(/in use/i)).toBeInTheDocument()
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
