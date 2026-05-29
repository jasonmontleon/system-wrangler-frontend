// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BulkLabelModal from './BulkLabelModal'

describe('BulkLabelModal', () => {
  it('does not render content when closed', () => {
    render(
      <BulkLabelModal
        isOpen={false}
        mode="add"
        count={3}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/label/i)).toBeNull()
  })

  it('shows the add header and selection count when opened in add mode', () => {
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={5}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/add label to selected systems/i)).toBeInTheDocument()
    // The count appears inside helper text — match the bold node.
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('parses key=value on submit', async () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'env=prod' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('env', 'prod', null),
    )
  })

  it('passes null for a bare-tag input in add mode', async () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'oncall' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('oncall', null, null),
    )
  })

  it('always passes null value in remove mode (key-only)', async () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="remove"
        count={1}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    // Even with a value, remove ignores it and removes by key.
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'env=prod' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('env', null, null),
    )
  })

  it('rejects empty input without calling onSubmit', () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('rejects a leading "=" (empty key) without calling onSubmit', () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: '=oops' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/Key is required/i)).toBeInTheDocument()
  })

  it('shows the "Label is required" error when the form is submitted empty', () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    // The primary Add button is disabled while the input is empty,
    // so click can't fire submit. The form's onSubmit handler runs
    // when the form is submitted directly (jsdom: fireEvent.submit).
    const form = document.querySelector('form') as HTMLFormElement
    fireEvent.submit(form)
    expect(screen.getByText(/Label is required/i)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('surfaces an error from onSubmit and clears the busy state', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('label-write-failed'))
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={2}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'env=prod' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))
    expect(await screen.findByText(/label-write-failed/i)).toBeInTheDocument()
  })

  it('selects the "Don\'t change" color swatch via aria-checked toggle', () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        canManageStyles
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    // The initial color choice is null ("Don't change"). Click a
    // colored swatch first, then click "Don't change" to flip back.
    const blue = screen.getByRole('radio', { name: /Set color to blue/i })
    fireEvent.click(blue)
    expect(blue).toHaveAttribute('aria-checked', 'true')
    const dontChange = screen.getByRole('radio', { name: /Don't change color/i })
    fireEvent.click(dontChange)
    expect(dontChange).toHaveAttribute('aria-checked', 'true')
  })

  it('hides the color section when canManageStyles is false', () => {
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        canManageStyles={false}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('radiogroup', { name: /label color/i })).toBeNull()
  })

  it('hides the color section in remove mode even with canManageStyles', () => {
    render(
      <BulkLabelModal
        isOpen={true}
        mode="remove"
        count={1}
        canManageStyles={true}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('radiogroup', { name: /label color/i })).toBeNull()
  })

  it('passes the chosen color through onSubmit', async () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        canManageStyles={true}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'env=prod' },
    })
    fireEvent.click(screen.getByRole('radio', { name: /set color to red/i }))
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('env', 'prod', 'red'),
    )
  })

  it('passes "auto" through onSubmit when the Auto swatch is chosen', async () => {
    const onSubmit = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        canManageStyles={true}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'env=prod' },
    })
    fireEvent.click(
      screen.getByRole('radio', { name: /clear color override/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith('env', 'prod', 'auto'),
    )
  })

  it('Cancel invokes onClose without submitting', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(
      <BulkLabelModal
        isOpen={true}
        mode="add"
        count={1}
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
