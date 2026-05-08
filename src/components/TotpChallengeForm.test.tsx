// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TotpChallengeForm from './TotpChallengeForm'

describe('TotpChallengeForm', () => {
  it('keeps verify disabled until a code is entered', () => {
    const onVerify = vi.fn()
    render(<TotpChallengeForm onVerify={onVerify} />)
    const submit = screen.getByRole('button', { name: /^verify$/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    })
    expect(submit).toBeEnabled()
  })

  it('submits the trimmed code and rememberDevice flag', async () => {
    const onVerify = vi.fn().mockResolvedValue({ id: 'u' })
    render(<TotpChallengeForm onVerify={onVerify} />)
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '  123456  ' },
    })
    fireEvent.click(screen.getByLabelText(/remember this browser/i))
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }))
    await waitFor(() => {
      expect(onVerify).toHaveBeenCalledWith('123456', true)
    })
  })

  it('toggles to recovery mode and clears the existing code', () => {
    const onVerify = vi.fn()
    render(<TotpChallengeForm onVerify={onVerify} />)
    const input = screen.getByLabelText(/authenticator code/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /use a recovery code/i }))
    // Label flips to recovery code
    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument()
    // Input is cleared so the digits don't carry into the recovery field
    const recoveryInput = screen.getByLabelText(/recovery code/i) as HTMLInputElement
    expect(recoveryInput.value).toBe('')
  })

  it('surfaces the verify error and leaves the form populated for retry', async () => {
    const onVerify = vi.fn().mockRejectedValue(new Error('invalid code'))
    render(<TotpChallengeForm onVerify={onVerify} />)
    const input = screen.getByLabelText(/authenticator code/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '999999' } })
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }))
    await waitFor(() => {
      expect(screen.getByText(/invalid code/i)).toBeInTheDocument()
    })
    expect(input.value).toBe('999999')
  })

  it('renders Back button when onCancel is provided and fires it', () => {
    const onVerify = vi.fn()
    const onCancel = vi.fn()
    render(<TotpChallengeForm onVerify={onVerify} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
