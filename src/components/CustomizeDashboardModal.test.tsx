// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CustomizeDashboardModal from './CustomizeDashboardModal'
import { WIDGETS } from '../dashboard/widgets'
import type { LayoutEntry } from '../hooks/useDashboardLayout'
import type { Group } from '../api/groups'

const SINGLETONS = WIDGETS.filter((w) => !w.templated)

function defaultLayout(): LayoutEntry[] {
  return SINGLETONS.map((w) => ({
    instanceId: w.id,
    widgetId: w.id,
    enabled: w.defaultEnabled,
  }))
}

function group(id: string, name: string): Group {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00Z',
    systemCount: 0,
  }
}

describe('CustomizeDashboardModal', () => {
  it('returns null when closed', () => {
    const { container } = render(
      <CustomizeDashboardModal
        isOpen={false}
        layout={defaultLayout()}
        groups={[]}
        onApply={() => {}}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('reorders an entry via the down arrow', () => {
    const onApply = vi.fn()
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    const firstSpec = SINGLETONS[0]
    fireEvent.click(
      screen.getByRole('button', { name: `Move ${firstSpec.title} down` }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const next = onApply.mock.calls[0][0] as LayoutEntry[]
    expect(next[0].widgetId).toBe(SINGLETONS[1].id)
    expect(next[1].widgetId).toBe(SINGLETONS[0].id)
  })

  it('toggles a widget off and surfaces it via apply', () => {
    const onApply = vi.fn()
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    const first = SINGLETONS[0]
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Show ${first.title}` }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const next = onApply.mock.calls[0][0] as LayoutEntry[]
    expect(next.find((e) => e.widgetId === first.id)?.enabled).toBe(false)
  })

  it('adds a per-group widget instance via the Add affordance', () => {
    const onApply = vi.fn()
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[group('g1', 'production')]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const next = onApply.mock.calls[0][0] as LayoutEntry[]
    const added = next.find((e) => e.params?.groupId === 'g1')
    expect(added).toBeDefined()
    expect(added?.enabled).toBe(true)
    expect(added?.widgetId.startsWith('group-')).toBe(true)
  })

  it('adds a blank S/M/L spacer via the Add buttons', () => {
    const onApply = vi.fn()
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add blank M card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add blank L card' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const next = onApply.mock.calls[0][0] as LayoutEntry[]
    const added = next.filter((e) => e.widgetId.startsWith('blank-'))
    expect(added).toHaveLength(2)
    expect(added.map((e) => e.widgetId)).toEqual(['blank-m', 'blank-l'])
    expect(added[0].params).toBeUndefined()
  })

  it('shows a help message when no groups exist', () => {
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={() => {}}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    expect(
      screen.getByText(/No groups available\. Create a group/i),
    ).toBeInTheDocument()
  })

  it('removes a templated instance via the trash button', () => {
    const onApply = vi.fn()
    const layout: LayoutEntry[] = [
      ...defaultLayout(),
      {
        instanceId: 'inst-1',
        widgetId: 'group-busiest-cpu',
        enabled: true,
        params: { groupId: 'g1' },
      },
    ]
    render(
      <CustomizeDashboardModal
        isOpen
        layout={layout}
        groups={[group('g1', 'production')]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Remove Busiest CPU — production/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const next = onApply.mock.calls[0][0] as LayoutEntry[]
    expect(next.find((e) => e.instanceId === 'inst-1')).toBeUndefined()
  })

  it('cancel does not call onApply', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={onClose}
      />,
    )
    const first = SINGLETONS[0]
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Show ${first.title}` }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('reset replaces the draft layout', () => {
    const onReset = vi.fn(() => defaultLayout())
    const layout: LayoutEntry[] = defaultLayout().map((e, i) =>
      i === 0 ? { ...e, enabled: false } : e,
    )
    render(
      <CustomizeDashboardModal
        isOpen
        layout={layout}
        groups={[]}
        onApply={() => {}}
        onReset={onReset}
        onClose={() => {}}
      />,
    )
    const first = SINGLETONS[0]
    expect(
      (screen.getByRole('checkbox', {
        name: `Show ${first.title}`,
      }) as HTMLInputElement).checked,
    ).toBe(false)
    fireEvent.click(
      screen.getByRole('button', { name: /Reset to defaults/i }),
    )
    expect(onReset).toHaveBeenCalled()
    expect(
      (screen.getByRole('checkbox', {
        name: `Show ${first.title}`,
      }) as HTMLInputElement).checked,
    ).toBe(true)
  })

  it('reorders rows via native HTML5 drag-and-drop', () => {
    const onApply = vi.fn()
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    const list = screen.getByRole('list', { name: 'Dashboard widgets' })
    const items = list.querySelectorAll(':scope > li')
    expect(items.length).toBeGreaterThanOrEqual(3)

    const dataTransfer = (() => {
      const data = new Map<string, string>()
      return {
        setData(key: string, value: string) {
          data.set(key, value)
        },
        getData(key: string) {
          return data.get(key) ?? ''
        },
        effectAllowed: 'move',
      }
    })() as unknown as DataTransfer

    // Drag the first row, hover over the third row's lower half, drop.
    fireEvent.dragStart(items[0], { dataTransfer })
    // jsdom's getBoundingClientRect returns zeros; the midpoint check
    // (clientY < midpoint = 0) falls into the "below" branch when
    // clientY is positive. Pass clientY=10 so dropAt = index + 1 = 3.
    fireEvent.dragOver(items[2], { dataTransfer, clientY: 10 })
    fireEvent.dragEnd(items[0], { dataTransfer })

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const next = onApply.mock.calls[0][0] as LayoutEntry[]
    // Original row 0 should now sit at index 2 (after the original row 2).
    expect(next[2].widgetId).toBe(SINGLETONS[0].id)
  })

  it('cancelling a drag (no dragOver) leaves the layout unchanged', () => {
    const onApply = vi.fn()
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={onApply}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    const list = screen.getByRole('list', { name: 'Dashboard widgets' })
    const items = list.querySelectorAll(':scope > li')
    const dataTransfer = (() => {
      const data = new Map<string, string>()
      return {
        setData(key: string, value: string) {
          data.set(key, value)
        },
        getData(key: string) {
          return data.get(key) ?? ''
        },
        effectAllowed: 'move',
      }
    })() as unknown as DataTransfer
    fireEvent.dragStart(items[0], { dataTransfer })
    fireEvent.dragEnd(items[0], { dataTransfer })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const next = onApply.mock.calls[0][0] as LayoutEntry[]
    expect(next.map((e) => e.widgetId)).toEqual(
      defaultLayout().map((e) => e.widgetId),
    )
  })

  it('disables move-up on the first row and move-down on the last row', () => {
    render(
      <CustomizeDashboardModal
        isOpen
        layout={defaultLayout()}
        groups={[]}
        onApply={() => {}}
        onReset={() => defaultLayout()}
        onClose={() => {}}
      />,
    )
    const first = SINGLETONS[0]
    const last = SINGLETONS[SINGLETONS.length - 1]
    expect(
      screen.getByRole('button', { name: `Move ${first.title} up` }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: `Move ${last.title} down` }),
    ).toBeDisabled()
  })
})
