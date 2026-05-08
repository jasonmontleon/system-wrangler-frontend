// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TwoFactorCard from './TwoFactorCard'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('TwoFactorCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the enabled state when initialEnabled is true', () => {
    render(<TwoFactorCard initialEnabled={true} />)
    expect(screen.getByRole('button', { name: /disable two-factor/i })).toBeInTheDocument()
  })

  it('runs the enable flow: setup -> confirm -> recovery codes -> done', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ secret: 'JBSWY3DP', uri: 'otpauth://x', qrPng: 'BASE64==' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ recoveryCodes: ['ABC12-DEF34', 'GHIJK-LMNOP'] }),
      )
    const onChange = vi.fn()
    render(<TwoFactorCard initialEnabled={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    await waitFor(() => {
      expect(screen.getByAltText(/totp qr code/i)).toBeInTheDocument()
    })
    // ClipboardCopy renders the secret as a read-only input value.
    expect(await screen.findByDisplayValue('JBSWY3DP')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))

    // The success state surfaces the recovery codes; wait for the "Done"
    // button to appear (it's the most stable anchor for this phase).
    const done = await screen.findByRole('button', { name: /^done$/i })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(done).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/i have saved these recovery codes/i))
    expect(done).toBeEnabled()
    fireEvent.click(done)
  })

  it('surfaces a setup error and lets the user retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 503))
    render(<TwoFactorCard initialEnabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    await waitFor(() => {
      expect(screen.getByText(/down/i)).toBeInTheDocument()
    })
  })

  it('surfaces a confirm error and leaves the user on the setup screen', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ secret: 'JBSWY3DP', uri: 'otpauth://x', qrPng: 'BASE64==' }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid code' }, 401))
    render(<TwoFactorCard initialEnabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/authenticator code/i)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    await waitFor(() => {
      expect(screen.getByText(/invalid code/i)).toBeInTheDocument()
    })
    // QR is still visible — user can try again with a fresh code.
    expect(screen.getByAltText(/totp qr code/i)).toBeInTheDocument()
  })

  it('cancels enrollment when the user clicks Cancel', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ secret: 'X', uri: 'otpauth://x', qrPng: 'B==' }),
    )
    render(<TwoFactorCard initialEnabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }))
    await waitFor(() => {
      expect(screen.getByAltText(/totp qr code/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByAltText(/totp qr code/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeInTheDocument()
  })

  it('disables 2FA via the modal and notifies onChange', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const onChange = vi.fn()
    render(<TwoFactorCard initialEnabled={true} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }))
    // PatternFly Modal renders into a portal; wait for the password field
    // to actually be in the document.
    const passwordInput = await screen.findByLabelText(/^password/i)
    fireEvent.change(passwordInput, { target: { value: 'correctpassword' } })
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }))
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
  })

  it('shows the disable error and keeps the modal open', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid credentials' }, 401))
    render(<TwoFactorCard initialEnabled={true} />)
    fireEvent.click(screen.getByRole('button', { name: /disable two-factor/i }))
    const passwordInput = await screen.findByLabelText(/^password/i)
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } })
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }))
    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    })
  })
})
