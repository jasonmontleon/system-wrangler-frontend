// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  )
}

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

type Routes = {
  authStatus?: () => Response
  authSetup?: (init: FetchInit) => Response
  authLogin?: (init: FetchInit) => Response
  authLogout?: () => Response
  health?: () => Response
  systems?: () => Response
  scope?: () => Response
  secrets?: () => Response
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
    if (url.endsWith('/api/me/scope')) {
      return routes.scope
        ? routes.scope()
        : jsonResponse({ global: '', groups: {} })
    }
    if (url.endsWith('/api/admin/secrets/undecryptable')) {
      return routes.secrets
        ? routes.secrets()
        : jsonResponse({ count: 0, items: [] })
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
      renderApp()
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /dashboard/i }),
        ).toBeInTheDocument()
      })
    })

    it('shows backend health once fetched', async () => {
      renderApp()
      await waitFor(() => {
        expect(screen.getByText(/status: ok/i)).toBeInTheDocument()
      })
    })

    it('switches to the Systems page when the Systems nav item is clicked', async () => {
      renderApp()
      // Inventory is collapsed by default at /, so click its toggle
      // first to expose the Systems link.
      const inventoryToggle = await screen.findByRole('button', {
        name: /^inventory$/i,
      })
      fireEvent.click(inventoryToggle)
      const systemsNav = await screen.findByText('Systems')
      fireEvent.click(systemsNav)
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /^systems$/i }),
        ).toBeInTheDocument()
      })
    })

    it('renders Inventory, Monitoring, and Administration as collapsible sections in that order', async () => {
      renderApp()
      // NavExpandable renders its title as a <button> toggle, so the
      // section labels are queryable by role=button.
      const inventory = await screen.findByRole('button', { name: /^inventory$/i })
      const monitoring = screen.getByRole('button', { name: /^monitoring$/i })
      const administration = screen.getByRole('button', { name: /^administration$/i })
      expect(inventory).toBeInTheDocument()
      expect(monitoring).toBeInTheDocument()
      expect(administration).toBeInTheDocument()
      // Order must be Dashboard → Inventory → Monitoring → Administration.
      const inventoryLi = inventory.closest('li')!
      const monitoringLi = monitoring.closest('li')!
      const administrationLi = administration.closest('li')!
      const navList = inventoryLi.parentElement!
      const order = Array.from(navList.children).indexOf
      expect(order.call(navList.children, inventoryLi)).toBeLessThan(
        order.call(navList.children, monitoringLi),
      )
      expect(order.call(navList.children, monitoringLi)).toBeLessThan(
        order.call(navList.children, administrationLi),
      )
      // Children live in DOM even when their section is collapsed —
      // the <section> just has the hidden attribute. The Monitoring
      // sub-list should still own the two Monitoring routes.
      const monitoringSection = monitoringLi.querySelector('section')
      expect(monitoringSection).not.toBeNull()
      expect(monitoringSection!.querySelector('a[href="/monitoring/systems-overview"]')).not.toBeNull()
      expect(monitoringSection!.querySelector('a[href="/monitoring/system-graphs"]')).not.toBeNull()
    })

    it('auto-expands Inventory on navigation to a Systems route', async () => {
      renderApp('/systems')
      const inventoryToggle = await screen.findByRole('button', {
        name: /^inventory$/i,
      })
      expect(inventoryToggle.getAttribute('aria-expanded')).toBe('true')
    })

    it('does not expose the theme toggle from the masthead', async () => {
      renderApp()
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
      renderApp()
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
      renderApp()
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
      renderApp()
      await screen.findByRole('button', { name: /user menu/i })
      expect(
        document.documentElement.classList.contains('pf-v6-theme-dark'),
      ).toBe(false)
    })
  })

  describe('mustChangePassword', () => {
    it('renders the ForcePasswordChange screen when the flag is set', async () => {
      installFetch({
        authStatus: () =>
          jsonResponse({
            setupRequired: false,
            authenticated: true,
            user: { ...sampleUser, mustChangePassword: true },
          }),
      })
      renderApp()
      expect(await screen.findByText(/Set a new password/i)).toBeInTheDocument()
    })
  })

  describe('global-admin extras', () => {
    it('navigates to the Users page when the banner action link is clicked', async () => {
      installFetch({
        scope: () => jsonResponse({ global: 'admin', groups: {} }),
        secrets: () =>
          jsonResponse({
            count: 1,
            items: [
              {
                kind: 'user_totp',
                field: 'secret',
                targetId: 'u-1',
                targetLabel: 'op',
                keyVersion: 1,
              },
            ],
          }),
      })
      renderApp()
      const link = await screen.findByRole('button', { name: /Open Users page/i })
      fireEvent.click(link)
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /^users$/i }),
        ).toBeInTheDocument()
      })
    })

    it('shows the UndecryptableSecretsBanner when there are affected secrets', async () => {
      installFetch({
        scope: () => jsonResponse({ global: 'admin', groups: {} }),
        secrets: () =>
          jsonResponse({
            count: 1,
            items: [
              {
                kind: 'user_totp',
                field: 'secret',
                targetId: 'u-1',
                targetLabel: 'op',
                keyVersion: 1,
              },
            ],
          }),
      })
      renderApp()
      expect(
        await screen.findByText(/cannot be decrypted with the current master key/i),
      ).toBeInTheDocument()
    })
  })

  describe('SidebarNav modifier-key handling', () => {
    async function expandInventoryAndGetSystemsLink() {
      const inventoryToggle = await screen.findByRole('button', {
        name: /^inventory$/i,
      })
      fireEvent.click(inventoryToggle)
      return screen.findByText('Systems')
    }

    it('lets ⌘-click fall through to the browser without intercepting', async () => {
      installFetch({})
      renderApp()
      const systemsNav = await expandInventoryAndGetSystemsLink()
      // Plain click would navigate via SPA; meta-click must NOT call
      // preventDefault, so the surrounding anchor can do its native
      // navigation. We assert preventDefault was not called.
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        metaKey: true,
      })
      const prevented = !systemsNav.dispatchEvent(event)
      expect(prevented).toBe(false)
    })

    it('respects defaultPrevented and does not re-route', async () => {
      installFetch({})
      renderApp()
      const systemsNav = await expandInventoryAndGetSystemsLink()
      // A click whose preventDefault was already called upstream
      // should be a no-op — App's NavItem onClick returns early.
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
      event.preventDefault()
      const prevented = !systemsNav.dispatchEvent(event)
      expect(prevented).toBe(true)
    })

    it('lets middle-click fall through without intercepting', async () => {
      installFetch({})
      renderApp()
      const systemsNav = await expandInventoryAndGetSystemsLink()
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 1,
      })
      const prevented = !systemsNav.dispatchEvent(event)
      expect(prevented).toBe(false)
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
      renderApp()
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
      renderApp()
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
      renderApp()
      await waitFor(() => {
        expect(
          screen.getByText(/could not reach backend/i),
        ).toBeInTheDocument()
      })
    })
  })
})
