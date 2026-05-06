// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LoginForm from './LoginForm'

describe('LoginForm', () => {
  it('disables the submit button until both fields are filled', () => {
    const onLogin = vi.fn()
    render(<LoginForm onLogin={onLogin} />)
    const submit = screen.getByRole('button', { name: /sign in/i })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    expect(submit).toBeEnabled()
  })

  it('calls onLogin with trimmed values when submitted', async () => {
    const onLogin = vi.fn().mockResolvedValue({ id: 'u', username: 'admin' })
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: '  admin  ' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('admin', 'correctpassword')
    })
  })

  it('shows the error message when onLogin throws', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('invalid credentials'))
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    })
  })
})
