// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

type Routes = {
  authStatus?: () => Response
  authSetup?: (init: FetchInit) => Response
  authLogin?: (init: FetchInit) => Response
  authLogout?: () => Response
  health?: () => Response
  hosts?: () => Response
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(routes: Routes) {
  const handler = vi.fn(async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.endsWith('/api/auth/status')) {
      return routes.authStatus
        ? routes.authStatus()
        : jsonResponse({ setupRequired: false, authenticated: true, user: { id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' } })
    }
    if (url.endsWith('/api/auth/setup')) {
      return routes.authSetup
        ? routes.authSetup(init)
        : jsonResponse({ id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' }, 201)
    }
    if (url.endsWith('/api/auth/login')) {
      return routes.authLogin
        ? routes.authLogin(init)
        : jsonResponse({ id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' })
    }
    if (url.endsWith('/api/auth/logout')) {
      return routes.authLogout ? routes.authLogout() : new Response(null, { status: 204 })
    }
    if (url.endsWith('/api/health')) {
      return routes.health ? routes.health() : jsonResponse({ status: 'ok' })
    }
    if (url.endsWith('/api/hosts')) {
      return routes.hosts ? routes.hosts() : jsonResponse([])
    }
    return new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', handler)
  return handler
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('pf-v6-theme-dark')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('pf-v6-theme-dark')
  })

  describe('authenticated', () => {
    beforeEach(() => {
      installFetch({})
    })

    it('renders the dashboard heading', async () => {
      render(<App />)
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /dashboard/i }),
        ).toBeInTheDocument()
      })
    })

    it('exposes the source link required by AGPL §13', async () => {
      render(<App />)
      const link = await screen.findByRole('link', { name: /source/i })
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
      const hostsNav = await screen.findByText('Hosts')
      fireEvent.click(hostsNav)
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /^hosts$/i }),
        ).toBeInTheDocument()
      })
    })

    it('starts in dark mode and toggles to light on button click', async () => {
      render(<App />)
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /switch to light mode/i }),
        ).toBeInTheDocument()
      })
      expect(
        document.documentElement.classList.contains('pf-v6-theme-dark'),
      ).toBe(true)

      fireEvent.click(
        screen.getByRole('button', { name: /switch to light mode/i }),
      )
      expect(
        document.documentElement.classList.contains('pf-v6-theme-dark'),
      ).toBe(false)
      expect(localStorage.getItem('sw-theme')).toBe('light')
    })

    it('exposes a sign-out button that calls logout', async () => {
      const fetchMock = installFetch({})
      render(<App />)
      const signOut = await screen.findByRole('button', { name: /sign out/i })
      fireEvent.click(signOut)
      await waitFor(() => {
        const calls = fetchMock.mock.calls.map((c) => String(c[0]))
        expect(calls).toContain('/api/auth/logout')
      })
    })
  })

  describe('setup required', () => {
    beforeEach(() => {
      installFetch({
        authStatus: () =>
          jsonResponse({ setupRequired: true, authenticated: false }),
      })
    })

    it('renders the SetupForm', async () => {
      render(<App />)
      await waitFor(() => {
        expect(screen.getByText(/create admin account/i)).toBeInTheDocument()
      })
    })
  })

  describe('not authenticated', () => {
    beforeEach(() => {
      installFetch({
        authStatus: () =>
          jsonResponse({ setupRequired: false, authenticated: false }),
      })
    })

    it('renders the LoginForm', async () => {
      render(<App />)
      await waitFor(() => {
        // CardTitle "Sign in" appears as text; the submit Button shares the
        // label, so allow either match.
        expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0)
      })
    })
  })

  describe('backend unreachable', () => {
    beforeEach(() => {
      installFetch({
        authStatus: () => new Response('', { status: 503 }),
      })
    })

    it('renders an error alert', async () => {
      render(<App />)
      await waitFor(() => {
        expect(
          screen.getByText(/could not reach backend/i),
        ).toBeInTheDocument()
      })
    })
  })
})
