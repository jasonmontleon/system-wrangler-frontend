// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import FanOutOutcomesPanel from './FanOutOutcomesPanel'
import type { FanOutOutcome } from '../util/updaterFanOut'

function outcome(overrides: Partial<FanOutOutcome> = {}): FanOutOutcome {
  return {
    systemId: 'sys-1',
    systemName: 'web-1',
    action: 'check',
    attempted: 1,
    skipped: false,
    results: [{ updaterId: 'dnf', displayName: 'dnf', ok: true }],
    ...overrides,
  }
}

describe('FanOutOutcomesPanel', () => {
  it('renders null when there are no outcomes', () => {
    const { container } = render(
      <FanOutOutcomesPanel outcomes={[]} onDismiss={() => {}} onRetry={() => {}} busy={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the UpdaterActionResults card when outcomes are present', () => {
    render(
      <MemoryRouter>
        <FanOutOutcomesPanel
          outcomes={[outcome()]}
          onDismiss={() => {}}
          onRetry={() => {}}
          busy={false}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('web-1')).toBeInTheDocument()
  })

  it('auto-dismisses after the idle window when not hovered', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(
      <MemoryRouter>
        <FanOutOutcomesPanel
          outcomes={[outcome()]}
          onDismiss={onDismiss}
          onRetry={() => {}}
          busy={false}
        />
      </MemoryRouter>,
    )
    await vi.advanceTimersByTimeAsync(9000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('pauses auto-dismiss while hovered and resumes on mouseLeave', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <FanOutOutcomesPanel
          outcomes={[outcome()]}
          onDismiss={onDismiss}
          onRetry={() => {}}
          busy={false}
        />
      </MemoryRouter>,
    )
    const panel = container.querySelector('div[style*="position: fixed"]') as HTMLElement
    expect(panel).toBeTruthy()
    fireEvent.mouseEnter(panel)
    await vi.advanceTimersByTimeAsync(9000)
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.mouseLeave(panel)
    await vi.advanceTimersByTimeAsync(9000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('pauses on focus and resumes on blur outside the panel', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <FanOutOutcomesPanel
          outcomes={[outcome()]}
          onDismiss={onDismiss}
          onRetry={() => {}}
          busy={false}
        />
      </MemoryRouter>,
    )
    const panel = container.querySelector('div[style*="position: fixed"]') as HTMLElement
    fireEvent.focus(panel)
    await vi.advanceTimersByTimeAsync(9000)
    expect(onDismiss).not.toHaveBeenCalled()
    // Blur with no relatedTarget inside the panel should clear hovered.
    fireEvent.blur(panel, { relatedTarget: null })
    await vi.advanceTimersByTimeAsync(9000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does not resume auto-dismiss when blur moves focus inside the panel', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <FanOutOutcomesPanel
          outcomes={[outcome()]}
          onDismiss={onDismiss}
          onRetry={() => {}}
          busy={false}
        />
      </MemoryRouter>,
    )
    const panel = container.querySelector('div[style*="position: fixed"]') as HTMLElement
    const inner = document.createElement('button')
    panel.appendChild(inner)
    fireEvent.focus(panel)
    fireEvent.blur(panel, { relatedTarget: inner })
    await vi.advanceTimersByTimeAsync(9000)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
