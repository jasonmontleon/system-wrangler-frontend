// SPDX-License-Identifier: Apache-2.0

// Widget cells on a 12-column dashboard grid. Each cell defines how
// many grid columns wide and how many grid rows tall the widget should
// be. Cells are fixed per widget in the registry; users do not change
// them. The S/M/L preset names are tiers the registry picks from, not
// user-facing settings.
export type WidgetCell = { colSpan: number; rowSpan: number }

// Row unit height in pixels. Sized so:
//   - an "M" cell (2 rows = 306 px) holds a MetricsPanel card with a
//     180-px chart plus title, time-range picker, and padding.
//   - an "L" cell (4 rows = 612 px) holds the system-health donut +
//     legend with breathing room.
export const ROW_UNIT_PX = 153

// All cells span half the dashboard (6 of 12 columns). Tiers vary by
// height only: a single L stacks vertically against two Ms or four S
// cards so a tall widget on the left can sit flush against shorter
// widgets on the right under grid-auto-flow: dense.
export const CELL_S: WidgetCell = { colSpan: 6, rowSpan: 1 }
export const CELL_M: WidgetCell = { colSpan: 6, rowSpan: 2 }
export const CELL_L: WidgetCell = { colSpan: 6, rowSpan: 4 }
