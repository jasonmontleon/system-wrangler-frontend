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
  systems?: () => Response
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const sampleUser = {
  id: 'u1',
  username: 'admin',
  email: '',
  theme: '',
  createdAt: '2026-05-06T12:00:00Z',
}

function installFetch(routes: Routes) {
  const handler = vi.fn(async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.endsWith('/api/auth/status')) {
      return routes.authStatus
        ? routes.authStatus()
        : jsonResponse({ setupRequired: false, authenticated: true, user: sampleUser })
    }
    if (url.endsWith('/api/auth/setup')) {
      return routes.authSetup ? routes.authSetup(init) : jsonResponse(sampleUser, 201)
    }
    if (url.endsWith('/api/auth/login')) {
      return routes.authLogin ? routes.authLogin(init) : jsonResponse(sampleUser)
    }
    if (url.endsWith('/api/auth/logout')) {
      return routes.authLogout ? routes.authLogout() : new Response(null, { status: 204 })
    }
    if (url.endsWith('/api/health')) {
      return routes.health ? routes.health() : jsonResponse({ status: 'ok' })
    }
    if (url.endsWith('/api/systems')) {
      return routes.systems ? routes.systems() : jsonResponse([])
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

    it('switches to the Systems page when the Systems nav item is clicked', async () => {
      render(<App />)
      const systemsNav = await screen.findByText('Systems')
      fireEvent.click(systemsNav)
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /^systems$/i }),
        ).toBeInTheDocument()
      })
    })

    it('does not expose the theme toggle from the masthead', async () => {
      render(<App />)
      await screen.findByRole('button', { name: /user menu/i })
      expect(
        screen.queryByRole('button', { name: /switch to light mode/i }),
      ).toBeNull()
      expect(
        screen.queryByRole('button', { name: /switch to dark mode/i }),
      ).toBeNull()
    })

    it('signs out via the user dropdown menu', async () => {
      const fetchMock = installFetch({})
      render(<App />)
      const menuToggle = await screen.findByRole('button', { name: /user menu/i })
      fireEvent.click(menuToggle)
      const signOut = await screen.findByRole('menuitem', { name: /sign out/i })
      fireEvent.click(signOut)
      await waitFor(() => {
        const calls = fetchMock.mock.calls.map((c) => String(c[0]))
        expect(calls).toContain('/api/auth/logout')
      })
    })

    it('navigates to the profile page from the user dropdown menu', async () => {
      render(<App />)
      const menuToggle = await screen.findByRole('button', { name: /user menu/i })
      fireEvent.click(menuToggle)
      const profile = await screen.findByRole('menuitem', { name: /profile/i })
      fireEvent.click(profile)
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /^profile$/i }),
        ).toBeInTheDocument()
      })
    })

    it("applies the user's stored theme preference on load", async () => {
      installFetch({
        authStatus: () =>
          jsonResponse({
            setupRequired: false,
            authenticated: true,
            user: { ...sampleUser, theme: 'light' },
          }),
      })
      render(<App />)
      await screen.findByRole('button', { name: /user menu/i })
      expect(
        document.documentElement.classList.contains('pf-v6-theme-dark'),
      ).toBe(false)
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
