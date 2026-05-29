// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ExclusionsCard from './ExclusionsCard'
import type { Exclusion } from '../api/exclusions'
import type { UpdaterDefinition } from '../api/updaters'

function row(over: Partial<Exclusion> = {}): Exclusion {
  return {
    id: 'e1',
    scope: 'global',
    updater: 'builtin.dnf',
    pattern: 'kernel*',
    reason: '',
    createdAt: '2026-05-25T00:00:00Z',
    createdBy: 'u-actor',
    ...over,
  }
}

function defs(): UpdaterDefinition[] {
  return [
    {
      id: 'builtin.dnf',
      source: 'builtin',
      displayName: 'dnf',
      description: 'Fedora dnf',
      detectBinary: 'dnf',
      checkPlaybook: '',
      applyPlaybook: '',
      checkOnly: false,
      supportsExclusions: true,
    },
    {
      id: 'builtin.pacman',
      source: 'builtin',
      displayName: 'pacman',
      description: 'Arch pacman',
      detectBinary: 'pacman',
      checkPlaybook: '',
      applyPlaybook: '',
      checkOnly: false,
      supportsExclusions: true,
    },
  ]
}

describe('ExclusionsCard', () => {
  it('renders the empty-state when there are no rows', () => {
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/no exclusions defined/i)).toBeInTheDocument()
  })

  it('renders existing rows in a table', () => {
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[row({ pattern: 'kernel*' }), row({ id: 'e2', pattern: 'nginx' })]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('kernel*')).toBeInTheDocument()
    expect(screen.getByText('nginx')).toBeInTheDocument()
  })

  it('hides the Add button when canManage is false', () => {
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage={false}
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /add exclusion/i })).toBeNull()
  })

  it('opens the form and submits the input to onCreate', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={onCreate}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add exclusion/i }))
    fireEvent.change(screen.getByLabelText('Updater'), {
      target: { value: 'builtin.pacman' },
    })
    fireEvent.change(screen.getByLabelText('Pattern'), {
      target: { value: 'linux' },
    })
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'fleet pin' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onCreate.mock.calls[0][0]).toEqual({
      updater: 'builtin.pacman',
      pattern: 'linux',
      reason: 'fleet pin',
    })
  })

  it('shows the hold-ownership notice in the add form', () => {
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add exclusion/i }))
    expect(
      screen.getByText(/Hold-based managers take ownership/i),
    ).toBeInTheDocument()
  })

  it('rejects an empty pattern with an inline error', () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={onCreate}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add exclusion/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(
      screen.getByText(/updater and pattern are required/i),
    ).toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('confirms before delete and calls onDelete with the row', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const target = row({ id: 'e9', pattern: 'redis' })
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[target]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove' }),
    )
    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    expect(onDelete.mock.calls[0][0]).toBe(target)
  })

  it('Cancel on the add form closes the modal without calling onCreate', async () => {
    const onCreate = vi.fn()
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={onCreate}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Add exclusion/i }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('Cancel on the delete confirm closes the modal without calling onDelete', async () => {
    const onDelete = vi.fn()
    const target = row({ id: 'e-cancel', pattern: 'redis' })
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[target]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    const dialog = await screen.findByRole('dialog')
    const cancels = screen.getAllByRole('button', { name: /^Cancel$/i })
    fireEvent.click(cancels[cancels.length - 1])
    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('surfaces a delete error inline when onDelete rejects', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('blocked'))
    const target = row({ id: 'e-err', pattern: 'redis' })
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[target]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    await screen.findByRole('dialog')
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove' })[
        screen.getAllByRole('button', { name: 'Remove' }).length - 1
      ],
    )
    expect(await screen.findByText(/blocked/i)).toBeInTheDocument()
  })

  it('shows the load-error banner when loadError is set', () => {
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={null}
        loadError="network down"
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/failed to load exclusions/i)).toBeInTheDocument()
    expect(screen.getByText(/network down/i)).toBeInTheDocument()
  })

  it('surfaces a create error inside the form without closing it', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('dup'))
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={onCreate}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add exclusion/i }))
    fireEvent.change(screen.getByLabelText('Pattern'), {
      target: { value: 'kernel' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(screen.getByText(/create failed/i)).toBeInTheDocument(),
    )
    // Form is still open so the user can correct + retry.
    expect(screen.getByLabelText('Pattern')).toHaveValue('kernel')
  })

  it('omits updaters that do not advertise supportsExclusions', () => {
    const mixedDefs: UpdaterDefinition[] = [
      {
        id: 'builtin.dnf',
        source: 'builtin',
        displayName: 'dnf',
        description: '',
        detectBinary: 'dnf',
        checkPlaybook: '',
        applyPlaybook: '',
        checkOnly: false,
        supportsExclusions: true,
      },
      {
        id: 'builtin.apt',
        source: 'builtin',
        displayName: 'apt',
        description: '',
        detectBinary: 'apt',
        checkPlaybook: '',
        applyPlaybook: '',
        checkOnly: false,
        supportsExclusions: false,
      },
      {
        id: 'builtin.fwupdmgr',
        source: 'builtin',
        displayName: 'fwupdmgr',
        description: '',
        detectBinary: 'fwupdmgr',
        checkPlaybook: '',
        applyPlaybook: '',
        checkOnly: true,
        supportsExclusions: false,
      },
    ]
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={mixedDefs}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add exclusion/i }))
    expect(
      screen.getByRole('option', { name: 'builtin.dnf' }),
    ).toBeInTheDocument()
    // Non-supporting builtins must NOT appear — they would let
    // operators add rules that silently no-op.
    expect(screen.queryByRole('option', { name: 'builtin.apt' })).toBeNull()
    expect(
      screen.queryByRole('option', { name: 'builtin.fwupdmgr' }),
    ).toBeNull()
    // `*` (every updater) is always present.
    expect(
      screen.getByRole('option', { name: /every updater/i }),
    ).toBeInTheDocument()
  })

  it('seeds the updater dropdown with * (every updater) when first opened', () => {
    render(
      <ExclusionsCard
        title="Fleet"
        description="d"
        rows={[]}
        loading={false}
        canManage
        updaters={defs()}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add exclusion/i }))
    const select = screen.getByLabelText('Updater') as HTMLSelectElement
    expect(select.value).toBe('*')
    // The dropdown still includes every defined updater so an operator
    // can narrow.
    expect(screen.getByRole('option', { name: 'builtin.dnf' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'builtin.pacman' }),
    ).toBeInTheDocument()
  })
})
