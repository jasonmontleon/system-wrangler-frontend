// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { CELL_L, CELL_M, CELL_S, ROW_UNIT_PX } from './widgetSize'

describe('widgetSize tiers', () => {
  it('exposes a positive row unit height', () => {
    expect(ROW_UNIT_PX).toBeGreaterThan(0)
  })

  it('puts every tier at half the dashboard width (6 of 12 columns)', () => {
    expect(CELL_S.colSpan).toBe(6)
    expect(CELL_M.colSpan).toBe(6)
    expect(CELL_L.colSpan).toBe(6)
  })

  it('stacks two M cells to the height of one L', () => {
    expect(CELL_L.rowSpan).toBe(CELL_M.rowSpan * 2)
  })

  it('stacks two S cells to the height of one M', () => {
    expect(CELL_M.rowSpan).toBe(CELL_S.rowSpan * 2)
  })
})
