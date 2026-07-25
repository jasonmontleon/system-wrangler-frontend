// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import UpdaterActionResults from './UpdaterActionResults'
import type { FanOutOutcome } from '../util/updaterFanOut'

function renderWith(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

const succeeded: FanOutOutcome = {
  systemId: 'a',
  systemName: 'host-a',
  action: 'check',
  attempted: 2,
  skipped: false,
  results: [
    { updaterId: 'builtin.dnf', displayName: 'dnf', ok: true, affectedCount: 3 },
    { updaterId: 'custom.pip', displayName: 'pip', ok: true, affectedCount: 1 },
  ],
}

const partial: FanOutOutcome = {
  systemId: 'b',
  systemName: 'host-b',
  action: 'check',
  attempted: 2,
  skipped: false,
  results: [
    { updaterId: 'builtin.dnf', displayName: 'dnf', ok: true, affectedCount: 0 },
    {
      updaterId: 'custom.pip',
      displayName: 'pip',
      ok: false,
      error: 'host key mismatch',
    },
  ],
}

const fullyFailed: FanOutOutcome = {
  systemId: 'c',
  systemName: 'host-c',
  action: 'check',
  attempted: 1,
  skipped: false,
  results: [
    {
      updaterId: 'builtin.dnf',
      displayName: 'dnf',
      ok: false,
      error: 'no accepted host key',
    },
  ],
}

const skipped: FanOutOutcome = {
  systemId: 'd',
  systemName: 'host-d',
  action: 'check',
  attempted: 0,
  skipped: true,
  skipReason: 'No enabled updaters',
  results: [],
}

describe('UpdaterActionResults', () => {
  it('returns null when there are no outcomes', () => {
    const { container } = renderWith(
      <UpdaterActionResults
        outcomes={[]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        busy={false}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('shows the all-succeeded aggregate badge when every system is clean', () => {
    renderWith(
      <UpdaterActionResults
        outcomes={[succeeded]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        busy={false}
      />,
    )
    expect(screen.getByText(/All 1 succeeded/i)).toBeInTheDocument()
  })

  it('breaks aggregates down when systems differ', () => {
    renderWith(
      <UpdaterActionResults
        outcomes={[succeeded, partial, fullyFailed, skipped]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        busy={false}
      />,
    )
    expect(screen.getByText(/1 succeeded/i)).toBeInTheDocument()
    expect(screen.getByText(/1 partial/i)).toBeInTheDocument()
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument()
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument()
  })

  it('renders skipped systems inline without an expandable body', () => {
    renderWith(
      <UpdaterActionResults
        outcomes={[skipped]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        busy={false}
      />,
    )
    expect(screen.getByText(/No enabled updaters/i)).toBeInTheDocument()
    // No expand toggle for a skipped row.
    expect(screen.queryByRole('button', { name: /Show/i })).toBeNull()
  })

  it('expands a system to show per-updater rows on click', () => {
    renderWith(
      <UpdaterActionResults
        outcomes={[partial]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        busy={false}
      />,
    )
    // PatternFly's ExpandableSection toggle is accessible as a
    // button whose name includes the toggleContent text.
    const toggle = screen.getByRole('button', { name: /host-b/i })
    fireEvent.click(toggle)
    // After expand the per-updater table appears.
    const table = screen.getByRole('grid', { name: /Per-updater results for host-b/i })
    expect(within(table).getByText('builtin.dnf')).toBeInTheDocument()
    expect(within(table).getByText('host key mismatch')).toBeInTheDocument()
  })

  it('renders a per-row Retry button on partial outcomes that calls onRetry', () => {
    const onRetry = vi.fn()
    renderWith(
      <UpdaterActionResults
        outcomes={[partial]}
        onDismiss={vi.fn()}
        onRetry={onRetry}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /host-b/i }))
    fireEvent.click(screen.getByRole('button', { name: /Retry on host-b/i }))
    expect(onRetry).toHaveBeenCalledWith(['b'], 'check')
  })

  it('renders an aggregate Retry button covering every non-success outcome', () => {
    const onRetry = vi.fn()
    renderWith(
      <UpdaterActionResults
        outcomes={[succeeded, partial, fullyFailed, skipped]}
        onDismiss={vi.fn()}
        onRetry={onRetry}
        busy={false}
      />,
    )
    // partial + fullyFailed = 2 systems; skipped does not count.
    const btn = screen.getByRole('button', { name: /Retry 2 failed systems/i })
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledWith(['b', 'c'], 'check')
  })

  it('disables Retry buttons while busy', () => {
    renderWith(
      <UpdaterActionResults
        outcomes={[partial]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        busy={true}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /host-b/i }))
    expect(screen.getByRole('button', { name: /Retry on host-b/i })).toBeDisabled()
  })

  it('Dismiss button invokes the callback', () => {
    const onDismiss = vi.fn()
    renderWith(
      <UpdaterActionResults
        outcomes={[succeeded]}
        onDismiss={onDismiss}
        onRetry={vi.fn()}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/i }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('links system names to their detail page', () => {
    renderWith(
      <UpdaterActionResults
        outcomes={[succeeded]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        busy={false}
      />,
    )
    const link = screen.getByRole('link', { name: 'host-a' })
    expect(link).toHaveAttribute('href', '/systems/a')
  })
})
