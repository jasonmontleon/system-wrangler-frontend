// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExportersPage from './ExportersPage'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const builtin = {
  id: 'builtin.dnf.exporter',
  source: 'builtin' as const,
  displayName: 'dnf — node_exporter',
  description: '',
  appliesToPkgManager: 'builtin.dnf',
  exporterKind: 'node_exporter' as const,
  bindPort: 9100,
  installPlaybook: '- hosts: all\n',
  statusPlaybook: '- hosts: all\n',
  removePlaybook: '',
}

const custom = {
  id: 'custom.fast',
  source: 'custom' as const,
  displayName: 'fast node_exporter',
  description: '',
  appliesToPkgManager: 'builtin.apt',
  exporterKind: 'node_exporter' as const,
  bindPort: 9100,
  installPlaybook: '- hosts: all\n',
  statusPlaybook: '- hosts: all\n',
  removePlaybook: '',
}

describe('ExportersPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists builtins and custom installers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ definitions: [builtin, custom] }),
    )
    render(<ExportersPage />)
    expect(await screen.findByText('custom.fast')).toBeInTheDocument()
    expect(screen.getByText('builtin.dnf.exporter')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Edit$/i })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /^View$/i })).toHaveLength(1)
  })

  it('shows empty-state when no installers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [] }))
    render(<ExportersPage />)
    expect(await screen.findByText(/No installers registered/i)).toBeInTheDocument()
  })

  it('surfaces a load error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network bad'))
    render(<ExportersPage />)
    expect(
      await screen.findByText(/Failed to load installers/i),
    ).toBeInTheDocument()
  })

  it('opens View modal for builtins (no Save)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [builtin] }))
    render(<ExportersPage />)
    await screen.findByText('builtin.dnf.exporter')
    fireEvent.click(screen.getByRole('button', { name: /^View$/i }))
    expect(
      await screen.findByRole('heading', { name: /View builtin\.dnf\.exporter/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Save|^Create/i }),
    ).toBeNull()
  })

  it('deletes a custom installer', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ definitions: [custom] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ definitions: [] }))
    render(<ExportersPage />)
    await screen.findByText('custom.fast')
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => {
      expect(screen.queryByText('custom.fast')).toBeNull()
    })
  })

  it('creates a new custom installer', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ definitions: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'custom.new', source: 'custom' }, { status: 201 }))
      .mockResolvedValueOnce(
        jsonResponse({
          definitions: [{ ...custom, id: 'custom.new', displayName: 'new exporter' }],
        }),
      )
    render(<ExportersPage />)
    await screen.findByText(/No installers registered/i)
    fireEvent.click(screen.getByRole('button', { name: /New custom installer/i }))
    fillCreateModal({ id: 'new', display: 'new exporter', pkgm: 'builtin.apt' })
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /New custom installer/i })).toBeNull()
    })
  })

  it('edits a custom installer through the modal', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ definitions: [custom] }))
      .mockResolvedValueOnce(jsonResponse({ ...custom, displayName: 'fast v2' }))
      .mockResolvedValueOnce(jsonResponse({ definitions: [{ ...custom, displayName: 'fast v2' }] }))
    render(<ExportersPage />)
    await screen.findByText('custom.fast')
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }))
    const dialog = await screen.findByRole('dialog')
    const display = dialog.querySelector('#exp-display') as HTMLInputElement
    fireEvent.change(display, { target: { value: 'fast v2' } })
    fireEvent.click(
      screen.getByRole('button', { name: /^Save changes$/i }),
    )
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]).endsWith('/api/admin/exporter-definitions/custom.fast') &&
          (c[1] as RequestInit | undefined)?.method === 'PATCH',
      )
      expect(patch).toBeDefined()
    })
  })

  it('surfaces a delete error from the API', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ definitions: [custom] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'in use' }, { status: 409 }))
    render(<ExportersPage />)
    await screen.findByText('custom.fast')
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }))
    expect(await screen.findByText('in use')).toBeInTheDocument()
  })

  it('Close on the editor modal returns to the table without saving', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ definitions: [custom] }))
    render(<ExportersPage />)
    await screen.findByText('custom.fast')
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }))
    const dialog = await screen.findByRole('dialog')
    const cancels = screen.getAllByRole('button', { name: /^Close|^Cancel/i })
    fireEvent.click(cancels[cancels.length - 1])
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
  })

  it('surfaces backend errors from create', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ definitions: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'duplicate' }, { status: 409 }))
    render(<ExportersPage />)
    await screen.findByText(/No installers registered/i)
    fireEvent.click(screen.getByRole('button', { name: /New custom installer/i }))
    fillCreateModal({ id: 'dup', display: 'd', pkgm: 'builtin.apt' })
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    expect(await screen.findByText('duplicate')).toBeInTheDocument()
  })
})

// fillCreateModal populates the New custom installer form. PatternFly
// v6's FormGroup duplicates labels in the DOM, so getByLabelText is
// ambiguous; we reach for the inputs positionally by getAllByRole.
function fillCreateModal({
  id,
  display,
  pkgm,
}: {
  id: string
  display: string
  pkgm: string
}) {
  const inputs = screen
    .getAllByRole('textbox')
    .filter((el) => el.tagName === 'INPUT')
  // Order: ID slug, Display name, Description, Applies to pkg manager,
  // Bind port (excluded — type=number isn't textbox). Then textareas
  // for install/status/remove.
  fireEvent.change(inputs[0], { target: { value: id } })
  fireEvent.change(inputs[1], { target: { value: display } })
  fireEvent.change(inputs[3], { target: { value: pkgm } })
  const textareas = screen
    .getAllByRole('textbox')
    .filter((el) => el.tagName === 'TEXTAREA')
  fireEvent.change(textareas[0], { target: { value: '- hosts: all\n' } })
  fireEvent.change(textareas[1], { target: { value: '- hosts: all\n' } })
}
