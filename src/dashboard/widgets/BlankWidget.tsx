// SPDX-License-Identifier: Apache-2.0

// BlankWidget is a spacer card with no content — exists so users can
// pad a layout to keep the grid visually symmetric. The widget itself
// doesn't read any context; the three sizes (S/M/L) are distinguished
// by registry entries that pin each instance to a cell.
export default function BlankWidget() {
  return (
    <div
      aria-hidden
      style={{
        height: '100%',
        width: '100%',
        border: '1px solid var(--pf-t--global--border--color--default)',
        borderRadius: 'var(--pf-t--global--border--radius--medium, 4px)',
        background: 'transparent',
      }}
    />
  )
}
