// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ForcePasswordChange from './ForcePasswordChange'

function inputs() {
  return {
    current: document.getElementById('force-pw-current') as HTMLInputElement,
    next: document.getElementById('force-pw-new') as HTMLInputElement,
    confirm: document.getElementById('force-pw-confirm') as HTMLInputElement,
  }
}

describe('ForcePasswordChange', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks submit until passwords match and meet length floor', () => {
    render(<ForcePasswordChange username="alice" onChanged={() => {}} />)
    const submit = screen.getByRole('button', { name: /set password/i })
    expect(submit).toBeDisabled()
    const { current, next, confirm } = inputs()
    fireEvent.change(current, { target: { value: 'oldoldold' } })
    fireEvent.change(next, { target: { value: 'short' } })
    fireEvent.change(confirm, { target: { value: 'short' } })
    expect(submit).toBeDisabled()
    fireEvent.change(next, { target: { value: 'longenoughpw' } })
    fireEvent.change(confirm, { target: { value: 'longenoughpw' } })
    expect(submit).not.toBeDisabled()
  })

  it('posts to /api/auth/password and calls onChanged on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const onChanged = vi.fn()
    render(<ForcePasswordChange username="alice" onChanged={onChanged} />)
    const { current, next, confirm } = inputs()
    fireEvent.change(current, { target: { value: 'adminset1' } })
    fireEvent.change(next, { target: { value: 'newchoice' } })
    fireEvent.change(confirm, { target: { value: 'newchoice' } })
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled()
    })
    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('/api/auth/password')
    expect(call[1].body).toBe(
      JSON.stringify({ currentPassword: 'adminset1', newPassword: 'newchoice' }),
    )
  })

  it('shows the server error when the change fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'current password incorrect' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<ForcePasswordChange username="alice" onChanged={() => {}} />)
    const { current, next, confirm } = inputs()
    fireEvent.change(current, { target: { value: 'wrongpass' } })
    fireEvent.change(next, { target: { value: 'newchoice' } })
    fireEvent.change(confirm, { target: { value: 'newchoice' } })
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))
    expect(await screen.findByText(/current password incorrect/i)).toBeInTheDocument()
  })
})
