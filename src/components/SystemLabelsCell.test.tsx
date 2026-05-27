// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SystemLabelsCell from './SystemLabelsCell'

describe('SystemLabelsCell', () => {
  it('pins the status chip with severity color and renders it first', () => {
    const { container } = render(
      <SystemLabelsCell
        status="unreachable"
        labels={[{ key: 'env', value: 'prod' }]}
      />,
    )
    // PatternFly LabelGroup renders the label list as an inner <ul>;
    // walking its children in order gives us a stable assertion that
    // status is the leading chip.
    const ul = container.querySelector('ul')
    expect(ul).not.toBeNull()
    const chips = within(ul as HTMLElement).getAllByText(/Unreachable|env=prod/)
    expect(chips[0]).toHaveTextContent('Unreachable')
    expect(chips[1]).toHaveTextContent('env=prod')
  })

  it('renders bare tags as the key alone', () => {
    render(
      <SystemLabelsCell
        status="reachable"
        labels={[{ key: 'oncall', value: null }]}
      />,
    )
    expect(screen.getByText('oncall')).toBeInTheDocument()
    // The bare-tag form must NOT include "=" so it round-trips into
    // the selector grammar correctly (`oncall` → has(oncall)).
    expect(screen.queryByText(/^oncall=/)).toBeNull()
  })

  it('renders empty-string values with a trailing "=" to match grammar', () => {
    render(
      <SystemLabelsCell
        status="reachable"
        labels={[{ key: 'tier', value: '' }]}
      />,
    )
    expect(screen.getByText('tier=')).toBeInTheDocument()
  })

  it('falls back to the unprobed style for unknown status values', () => {
    render(
      // @ts-expect-error - intentionally probing the runtime fallback
      <SystemLabelsCell status="nonsense" labels={[]} />,
    )
    expect(screen.getByText('Unprobed')).toBeInTheDocument()
  })

  it('handles missing labels prop (system with no labels yet)', () => {
    render(<SystemLabelsCell status="reachable" labels={undefined} />)
    expect(screen.getByText('Reachable')).toBeInTheDocument()
  })

  it('renders the same key the same way regardless of value (hash fallback)', () => {
    // No styleOverrides → colorFor falls back to the deterministic
    // hash. Both chips share the same key "env" so their PatternFly
    // color class should match.
    const { container } = render(
      <SystemLabelsCell
        status="reachable"
        labels={[
          { key: 'env', value: 'prod' },
          { key: 'env', value: 'staging' },
        ]}
      />,
    )
    const chips = container.querySelectorAll('[data-testid="label-user"]')
    expect(chips).toHaveLength(2)
    const cls = (el: Element) =>
      [...el.classList].filter((c) => c.startsWith('pf-m-')).sort().join(' ')
    expect(cls(chips[0])).toBe(cls(chips[1]))
  })

  it('honors a styleOverrides entry over the hash fallback', () => {
    const { container } = render(
      <SystemLabelsCell
        status="reachable"
        labels={[{ key: 'env', value: 'prod' }]}
        styleOverrides={{ env: 'red' }}
      />,
    )
    const chip = container.querySelector('[data-testid="label-user"]')!
    // PatternFly v6 emits a pf-m-red modifier class on red-tinted
    // labels.
    expect([...chip.classList].some((c) => c.includes('red'))).toBe(true)
  })

  it('invokes onLabelClick with the clicked user label', () => {
    const onLabelClick = vi.fn()
    render(
      <SystemLabelsCell
        status="reachable"
        labels={[{ key: 'env', value: 'prod' }]}
        onLabelClick={onLabelClick}
      />,
    )
    fireEvent.click(screen.getByText('env=prod'))
    expect(onLabelClick).toHaveBeenCalledWith({ key: 'env', value: 'prod' })
  })

  it('emits a synthetic status label on status-chip click', () => {
    const onLabelClick = vi.fn()
    render(
      <SystemLabelsCell
        status="reachable"
        labels={[]}
        onLabelClick={onLabelClick}
      />,
    )
    fireEvent.click(screen.getByText('Reachable'))
    expect(onLabelClick).toHaveBeenCalledWith({
      key: 'status',
      value: 'reachable',
    })
  })

  it('caps visible chips and surfaces a "+N more" overflow control', () => {
    const labels = Array.from({ length: 6 }, (_, i) => ({
      key: `k${i}`,
      value: `v${i}`,
    }))
    render(<SystemLabelsCell status="reachable" labels={labels} numLabels={2} />)
    // PatternFly renders the overflow as a clickable chip whose text
    // matches the collapsedText template's `${remaining}` count.
    // With numLabels=2 (status + 1 user), 5 user labels are hidden.
    expect(screen.getByText(/more/)).toHaveTextContent('5 more')
  })

})
