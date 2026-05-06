// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/api/health')) {
          return Promise.resolve(
            new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
          )
        }
        if (url.endsWith('/api/hosts')) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        return Promise.resolve(new Response('', { status: 404 }))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the dashboard heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /dashboard/i }),
    ).toBeInTheDocument()
  })

  it('exposes the source link required by AGPL §13', () => {
    render(<App />)
    const link = screen.getByRole('link', { name: /source/i })
    expect(link).toHaveAttribute('href')
    expect(link.getAttribute('href')).toMatch(/^https?:\/\//)
  })

  it('shows backend health once fetched', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText(/status: ok/i)).toBeInTheDocument()
    })
  })

  it('switches to the Hosts page when the Hosts nav item is clicked', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('Hosts'))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^hosts$/i })).toBeInTheDocument()
    })
  })
})
