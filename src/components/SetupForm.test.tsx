// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SetupForm from './SetupForm'

describe('SetupForm', () => {
  it('keeps the submit button disabled while inputs are invalid', () => {
    const onSetup = vi.fn()
    render(<SetupForm onSetup={onSetup} />)
    const submit = screen.getByRole('button', { name: /create account/i })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/^username/i), {
      target: { value: 'admin' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'short' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'correctpassword' },
    })
    expect(submit).toBeDisabled() // confirm still empty

    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'correctpassword' },
    })
    expect(submit).toBeEnabled()
  })

  it('shows a mismatch warning when confirm differs', () => {
    const onSetup = vi.fn()
    render(<SetupForm onSetup={onSetup} />)
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'different' },
    })
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument()
  })

  it('calls onSetup with the trimmed username and password', async () => {
    const onSetup = vi.fn().mockResolvedValue({ id: 'u', username: 'admin' })
    render(<SetupForm onSetup={onSetup} />)
    fireEvent.change(screen.getByLabelText(/^username/i), {
      target: { value: '  admin  ' },
    })
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => {
      expect(onSetup).toHaveBeenCalledWith('admin', 'correctpassword')
    })
  })

  it('shows error when onSetup rejects', async () => {
    const onSetup = vi.fn().mockRejectedValue(new Error('boom'))
    render(<SetupForm onSetup={onSetup} />)
    fireEvent.change(screen.getByLabelText(/^username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/^password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => {
      expect(screen.getByText(/boom/i)).toBeInTheDocument()
    })
  })
})
