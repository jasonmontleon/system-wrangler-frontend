// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BackupPage from './BackupPage'

describe('BackupPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the two-things warning copy', () => {
    render(<BackupPage download={() => {}} />)
    expect(
      screen.getByText(/Two files, separate media/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/mismatched key permanently loses/i),
    ).toBeInTheDocument()
  })

  it('downloads on click and shows a success alert', async () => {
    const body = new Uint8Array(2_500_000)
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.sqlite3',
          'Content-Disposition':
            'attachment; filename="system-wrangler-20260515T123456Z.db"',
        },
      }),
    )
    const trigger = vi.fn()
    render(<BackupPage download={trigger} />)

    fireEvent.click(screen.getByRole('button', { name: /download backup/i }))

    await waitFor(() => {
      expect(trigger).toHaveBeenCalledTimes(1)
    })
    const [blob, filename] = trigger.mock.calls[0]
    expect(filename).toBe('system-wrangler-20260515T123456Z.db')
    expect(blob.size).toBe(body.byteLength)
    expect(
      await screen.findByText(/backup downloaded/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/system-wrangler-20260515T123456Z\.db.*MiB/),
    ).toBeInTheDocument()
  })

  it('renders an error alert when the request fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'another backup is already in progress' }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    const trigger = vi.fn()
    render(<BackupPage download={trigger} />)

    fireEvent.click(screen.getByRole('button', { name: /download backup/i }))

    expect(
      await screen.findByText(/another backup is already in progress/i),
    ).toBeInTheDocument()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('surfaces non-Error throwables from the fetch', async () => {
    fetchMock.mockRejectedValueOnce('boom')
    render(<BackupPage download={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /download backup/i }))
    expect(await screen.findByText(/boom/i)).toBeInTheDocument()
  })

  it('disables the button while a request is in flight', async () => {
    let resolveFetch: (resp: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    render(<BackupPage download={() => {}} />)
    const button = screen.getByRole('button', { name: /download backup/i })
    fireEvent.click(button)
    await waitFor(() => {
      expect(button).toBeDisabled()
    })
    resolveFetch(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    await waitFor(() => {
      expect(button).not.toBeDisabled()
    })
  })

  it('falls through to the default browser anchor when download is unset', async () => {
    const body = new Uint8Array([1, 2, 3])
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="sw.db"',
        },
      }),
    )

    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
    // jsdom doesn't implement anchor navigation; stub click() so the
    // default path runs without spamming "Not implemented" warnings.
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    try {
      render(<BackupPage />)
      fireEvent.click(screen.getByRole('button', { name: /download backup/i }))
      await waitFor(() => {
        expect(createObjectURL).toHaveBeenCalledTimes(1)
      })
      expect(anchorClick).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      anchorClick.mockRestore()
    }
  })
})
