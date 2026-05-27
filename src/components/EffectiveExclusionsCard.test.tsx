// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import EffectiveExclusionsCard from './EffectiveExclusionsCard'
import type { Exclusion } from '../api/exclusions'
import type { SystemUpdater } from '../api/updaters'
import * as exclusionsApi from '../api/exclusions'

function renderWith(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

function updater(over: Partial<SystemUpdater> = {}): SystemUpdater {
  return {
    updaterId: 'builtin.apt',
    source: 'builtin',
    displayName: 'apt',
    installed: true,
    enabled: true,
    checkOnly: false,
    pendingPackages: [],
    ...over,
  }
}

function row(over: Partial<Exclusion> = {}): Exclusion {
  return {
    id: 'e1',
    scope: 'system',
    targetId: 'sys-1',
    updater: 'builtin.apt',
    pattern: 'vim',
    reason: '',
    createdAt: '2026-05-26T00:00:00Z',
    createdBy: 'u-actor',
    ...over,
  }
}

describe('EffectiveExclusionsCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the no-updaters guard when nothing is installed', () => {
    renderWith(
      <EffectiveExclusionsCard
        systemId="sys-1"
        updaters={[updater({ installed: false })]}
      />,
    )
    expect(screen.getByText(/run Inspect to populate/i)).toBeInTheDocument()
  })

  it('loads effective exclusions for the first installed updater', async () => {
    const spy = vi
      .spyOn(exclusionsApi, 'listEffectiveSystemExclusions')
      .mockResolvedValue([row({ pattern: 'vim' })])

    renderWith(
      <EffectiveExclusionsCard
        systemId="sys-1"
        updaters={[updater({ updaterId: 'builtin.apt' })]}
      />,
    )
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sys-1', 'builtin.apt'),
    )
    expect(await screen.findByText('vim')).toBeInTheDocument()
  })

  it('re-fetches when the updater selection changes', async () => {
    const spy = vi
      .spyOn(exclusionsApi, 'listEffectiveSystemExclusions')
      .mockResolvedValue([])

    renderWith(
      <EffectiveExclusionsCard
        systemId="sys-1"
        updaters={[
          updater({ updaterId: 'builtin.apt', displayName: 'apt' }),
          updater({ updaterId: 'builtin.brew', displayName: 'brew' }),
        ]}
      />,
    )
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sys-1', 'builtin.apt'))

    const select = screen.getByLabelText('Updater') as HTMLSelectElement
    await act(async () => {
      fireEvent.change(select, { target: { value: 'builtin.brew' } })
    })
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sys-1', 'builtin.brew'),
    )
  })

  it('renders rows with source badges and per-scope manage links', async () => {
    vi.spyOn(exclusionsApi, 'listEffectiveSystemExclusions').mockResolvedValue([
      row({ id: 'g', scope: 'global', targetId: '', pattern: 'kernel*' }),
      row({ id: 'gr', scope: 'group', targetId: 'grp-9', pattern: 'nginx' }),
      row({ id: 's', scope: 'system', targetId: 'sys-1', pattern: 'vim' }),
    ])

    renderWith(
      <EffectiveExclusionsCard
        systemId="sys-1"
        updaters={[updater()]}
      />,
    )

    expect(await screen.findByText('kernel*')).toBeInTheDocument()
    expect(screen.getByText('nginx')).toBeInTheDocument()
    expect(screen.getByText('vim')).toBeInTheDocument()

    const adminLink = screen.getByRole('link', { name: /Admin → Exclusions/ })
    expect(adminLink).toHaveAttribute('href', '/exclusions')

    const groupLink = screen.getByRole('link', { name: /Group → Exclusions/ })
    expect(groupLink).toHaveAttribute('href', '/groups/grp-9')

    // System-scope rows have no link — the operator is already here.
    expect(screen.getByText('This system')).toBeInTheDocument()
  })

  it('renders the empty state when the union is empty', async () => {
    vi.spyOn(exclusionsApi, 'listEffectiveSystemExclusions').mockResolvedValue([])
    renderWith(
      <EffectiveExclusionsCard
        systemId="sys-1"
        updaters={[updater()]}
      />,
    )
    expect(
      await screen.findByText(/No exclusions apply to this updater/i),
    ).toBeInTheDocument()
  })

  it('surfaces a load error inline', async () => {
    vi.spyOn(exclusionsApi, 'listEffectiveSystemExclusions').mockRejectedValue(
      new Error('boom'),
    )
    renderWith(
      <EffectiveExclusionsCard
        systemId="sys-1"
        updaters={[updater()]}
      />,
    )
    expect(
      await screen.findByText(/Failed to load effective exclusions/i),
    ).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('drops the selection when the previously-picked updater is uninstalled', async () => {
    const spy = vi
      .spyOn(exclusionsApi, 'listEffectiveSystemExclusions')
      .mockResolvedValue([])
    const { rerender } = render(
      <MemoryRouter>
        <EffectiveExclusionsCard
          systemId="sys-1"
          updaters={[
            updater({ updaterId: 'builtin.apt' }),
            updater({ updaterId: 'builtin.brew' }),
          ]}
        />
      </MemoryRouter>,
    )
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sys-1', 'builtin.apt'))

    rerender(
      <MemoryRouter>
        <EffectiveExclusionsCard
          systemId="sys-1"
          updaters={[updater({ updaterId: 'builtin.brew' })]}
        />
      </MemoryRouter>,
    )
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sys-1', 'builtin.brew'))
  })
})
