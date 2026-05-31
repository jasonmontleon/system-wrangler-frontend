// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { BLANK_WIDGET_IDS, isWidgetId, WIDGETS, WIDGETS_BY_ID } from './widgets'
import { CELL_L, CELL_M, CELL_S } from './widgetSize'

describe('widget registry', () => {
  it('has 16 single-instance widgets, 13 per-group templates, and 3 blank templates', () => {
    expect(WIDGETS.filter((w) => !w.templated)).toHaveLength(16)
    expect(WIDGETS.filter((w) => w.templated)).toHaveLength(16)
  })

  it('has unique ids', () => {
    const ids = WIDGETS.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('disables every templated widget by default', () => {
    for (const w of WIDGETS) {
      if (w.templated) expect(w.defaultEnabled).toBe(false)
    }
  })

  it('default-enables only system-health and backend-health', () => {
    // Brand-new System Wrangler installs have no metrics history and
    // possibly no systems yet, so a blank dashboard with just the two
    // status cards is the right first impression. Users opt into
    // leaderboards, trends, and per-group widgets via Customize.
    const defaultEnabled = WIDGETS.filter((w) => w.defaultEnabled).map((w) => w.id)
    expect(defaultEnabled).toEqual(['system-health', 'backend-health'])
  })

  it('exposes per-group variants and S/M/L blank spacers as templates', () => {
    const templates = WIDGETS.filter((w) => w.templated)
    expect(templates.map((t) => t.id).sort()).toEqual([
      'blank-l',
      'blank-m',
      'blank-s',
      'group-busiest-cpu',
      'group-cpu-trend',
      'group-disk-io-trend',
      'group-fs-trend',
      'group-highest-disk-io',
      'group-highest-network-io',
      'group-lowest-free-disk',
      'group-lowest-free-memory',
      'group-memory-trend',
      'group-most-pending-updates',
      'group-network-io-trend',
      'group-system-health',
      'group-system-health-compact',
    ])
  })

  it('ships compact and legend variants of the system-health widget', () => {
    expect(WIDGETS_BY_ID.get('system-health-compact')?.cell).toBe(CELL_M)
    expect(WIDGETS_BY_ID.get('system-health-compact')?.templated).toBe(false)
    expect(WIDGETS_BY_ID.get('system-health-legend')?.cell).toBe(CELL_M)
    expect(WIDGETS_BY_ID.get('group-system-health-compact')?.cell).toBe(CELL_M)
    expect(WIDGETS_BY_ID.get('group-system-health-compact')?.templated).toBe(
      true,
    )
  })

  it('pins each blank spacer to its matching cell', () => {
    expect(BLANK_WIDGET_IDS).toEqual(['blank-s', 'blank-m', 'blank-l'])
    expect(WIDGETS_BY_ID.get('blank-s')?.cell).toBe(CELL_S)
    expect(WIDGETS_BY_ID.get('blank-m')?.cell).toBe(CELL_M)
    expect(WIDGETS_BY_ID.get('blank-l')?.cell).toBe(CELL_L)
  })

  it('builds an id-keyed lookup map containing every widget', () => {
    for (const w of WIDGETS) {
      expect(WIDGETS_BY_ID.get(w.id)).toBe(w)
    }
    expect(WIDGETS_BY_ID.size).toBe(WIDGETS.length)
  })

  it('recognises known ids and rejects unknown ones', () => {
    expect(isWidgetId('busiest-cpu')).toBe(true)
    expect(isWidgetId('not-a-widget')).toBe(false)
    expect(isWidgetId(42)).toBe(false)
    expect(isWidgetId(null)).toBe(false)
  })

  it('assigns L to system health, M to trends + leaderboards, S to backend health', () => {
    expect(WIDGETS_BY_ID.get('system-health' as never)?.cell).toBe(CELL_L)
    expect(WIDGETS_BY_ID.get('backend-health' as never)?.cell).toBe(CELL_S)
    for (const id of [
      'global-cpu-trend',
      'global-memory-trend',
      'global-fs-trend',
      'global-network-io-trend',
      'global-disk-io-trend',
      'busiest-cpu',
      'lowest-free-memory',
      'lowest-free-disk',
      'highest-network-io',
      'highest-disk-io',
      'most-pending-updates',
    ]) {
      expect(WIDGETS_BY_ID.get(id as never)?.cell).toBe(CELL_M)
    }
  })
})
