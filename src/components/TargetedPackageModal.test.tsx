// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import TargetedPackageModal from './TargetedPackageModal'
import type { System } from '../api/systems'
import type { SystemUpdater } from '../api/updaters'

function mkSystem(id: string, name: string): System {
  return {
    id,
    name,
    hostname: name,
    createdAt: '2026-01-01T00:00:00Z',
    status: 'reachable',
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function updaterPayload(updaters: Partial<SystemUpdater>[]) {
  const full = updaters.map((u) => ({
    updaterId: 'builtin.dnf',
    source: 'builtin',
    displayName: 'dnf',
    installed: true,
    enabled: true,
    checkOnly: false,
    pendingPackages: [],
    ...u,
  }))
  return jsonResponse({ updaters: full })
}

describe('TargetedPackageModal', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one row per (updater, package) pair with host counts and version range', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0.1', newVersion: '3.0.2' },
            { name: 'curl', oldVersion: '8.0', newVersion: '8.1' },
          ],
        },
        {
          updaterId: 'builtin.flatpak',
          displayName: 'flatpak',
          pendingPackages: [
            { name: 'openssl', oldVersion: '', newVersion: '' },
          ],
        },
      ]),
    )
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0.1', newVersion: '3.0.2' },
          ],
        },
      ]),
    )
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1'), mkSystem('b', 'web-2')]}
        onSubmit={() => {}}
      />,
    )
    const grid = await screen.findByRole('grid', {
      name: /pending packages across selected systems/i,
    })
    const rows = within(grid).getAllByRole('row')
    // header + 3 data rows: dnf|openssl (2 hosts), dnf|curl (1), flatpak|openssl (1)
    expect(rows).toHaveLength(4)
    // First data row is dnf|openssl with host count 2 and uniform versions.
    const first = rows[1]
    expect(within(first).getByText('openssl')).toBeInTheDocument()
    expect(within(first).getByText('3.0.1 → 3.0.2')).toBeInTheDocument()
    expect(within(first).getByText('2')).toBeInTheDocument()
    // dnf and flatpak appear as separate updater rows for openssl.
    const opensslRows = within(grid)
      .getAllByText('openssl')
      .map((el) => el.closest('tr')!)
    expect(opensslRows.length).toBe(2)
    const updaterIds = opensslRows.flatMap((r) =>
      within(r).getAllByText(/builtin\.(dnf|flatpak)/),
    )
    expect(updaterIds.length).toBe(2)
  })

  it('shows the from→to version when every host agrees', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0.1', newVersion: '3.0.2' },
          ],
        },
      ]),
    )
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0.1', newVersion: '3.0.2' },
          ],
        },
      ]),
    )
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1'), mkSystem('b', 'web-2')]}
        onSubmit={() => {}}
      />,
    )
    expect(
      await screen.findByText('3.0.1 → 3.0.2'),
    ).toBeInTheDocument()
  })

  it('shows "N variants" when hosts disagree on the version transition', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0.1', newVersion: '3.0.2' },
          ],
        },
      ]),
    )
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '2.9', newVersion: '3.0.2' },
          ],
        },
      ]),
    )
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1'), mkSystem('b', 'web-2')]}
        onSubmit={() => {}}
      />,
    )
    expect(await screen.findByText('2 variants')).toBeInTheDocument()
  })

  it('renders "—" for the version when every host emits blank version data (flatpak / snap-style)', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.flatpak',
          displayName: 'flatpak',
          pendingPackages: [
            {
              name: 'org.mozilla.firefox',
              oldVersion: '',
              newVersion: '',
            },
          ],
        },
      ]),
    )
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1')]}
        onSubmit={() => {}}
      />,
    )
    expect(
      await screen.findByText('org.mozilla.firefox'),
    ).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('skips updaters that are not installed / not enabled / check-only', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.fwupdmgr',
          displayName: 'fwupdmgr',
          checkOnly: true,
          pendingPackages: [
            { name: 'firmware-bios', oldVersion: '1.0', newVersion: '1.1' },
          ],
        },
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          installed: false,
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0', newVersion: '3.1' },
          ],
        },
        {
          updaterId: 'custom.disabled',
          displayName: 'disabled',
          enabled: false,
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0', newVersion: '3.1' },
          ],
        },
      ]),
    )
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1')]}
        onSubmit={() => {}}
      />,
    )
    await waitFor(() => {
      expect(
        screen.getByText(/no pending packages on the selected systems/i),
      ).toBeInTheDocument()
    })
  })

  it('filters by package name or updater name', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '', newVersion: '' },
            { name: 'curl', oldVersion: '', newVersion: '' },
          ],
        },
      ]),
    )
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1')]}
        onSubmit={() => {}}
      />,
    )
    await screen.findByText('openssl')
    const input = screen.getByLabelText(/filter packages/i)
    fireEvent.change(input, { target: { value: 'curl' } })
    expect(screen.queryByText('openssl')).toBeNull()
    expect(screen.getByText('curl')).toBeInTheDocument()
  })

  it('disables Update until at least one row is selected then submits structured selections', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '3.0', newVersion: '3.1' },
          ],
        },
      ]),
    )
    const onSubmit = vi.fn()
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1')]}
        onSubmit={onSubmit}
      />,
    )
    await screen.findByText('openssl')
    const submit = screen.getByRole('button', { name: /^update/i })
    expect(submit).toBeDisabled()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /select openssl on dnf/i }),
    )
    expect(submit).not.toBeDisabled()
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith([
      { updaterId: 'builtin.dnf', packageName: 'openssl' },
    ])
  })

  it('cancel fires onClose', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '', newVersion: '' },
          ],
        },
      ]),
    )
    const onClose = vi.fn()
    render(
      <TargetedPackageModal
        isOpen
        onClose={onClose}
        systems={[mkSystem('a', 'web-1')]}
        onSubmit={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the empty state when no selected system has any pending package', async () => {
    fetchMock.mockResolvedValueOnce(updaterPayload([]))
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1')]}
        onSubmit={() => {}}
      />,
    )
    await waitFor(() => {
      expect(
        screen.getByText(/no pending packages on the selected systems/i),
      ).toBeInTheDocument()
    })
  })

  it('shows the "no matches" empty state when the filter excludes every row', async () => {
    fetchMock.mockResolvedValueOnce(
      updaterPayload([
        {
          updaterId: 'builtin.dnf',
          displayName: 'dnf',
          pendingPackages: [
            { name: 'openssl', oldVersion: '', newVersion: '' },
          ],
        },
      ]),
    )
    render(
      <TargetedPackageModal
        isOpen
        onClose={() => {}}
        systems={[mkSystem('a', 'web-1')]}
        onSubmit={() => {}}
      />,
    )
    await screen.findByText('openssl')
    fireEvent.change(screen.getByLabelText(/filter packages/i), {
      target: { value: 'zzz-no-match' },
    })
    expect(screen.getByText(/no packages match the filter/i)).toBeInTheDocument()
  })
})
