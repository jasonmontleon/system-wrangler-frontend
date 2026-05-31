// SPDX-License-Identifier: Apache-2.0

import { useState, type ReactNode } from 'react'
import {
  Alert,
  Bullseye,
  Dropdown,
  DropdownItem,
  DropdownList,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MenuToggle,
  type MenuToggleElement,
  Nav,
  NavExpandable,
  NavItem,
  NavList,
  Page,
  PageSidebar,
  PageSidebarBody,
  PageSection,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AuditPage from './pages/AuditPage'
import BackupPage from './pages/BackupPage'
import SettingsPage from './pages/SettingsPage'
import CredentialsPage from './pages/CredentialsPage'
import DashboardPage from './pages/DashboardPage'
import GroupDetailPage from './pages/GroupDetailPage'
import GroupsPage from './pages/GroupsPage'
import NotFoundPage from './pages/NotFoundPage'
import ProfilePage from './pages/ProfilePage'
import SystemDetailPage from './pages/SystemDetailPage'
import SystemsPage from './pages/SystemsPage'
import UpdatersPage from './pages/UpdatersPage'
import ExclusionsPage from './pages/ExclusionsPage'
import ExportersPage from './pages/ExportersPage'
import SystemsOverviewPage from './pages/SystemsOverviewPage'
import SystemGraphsPage from './pages/SystemGraphsPage'
import UsersPage from './pages/UsersPage'
import ForcePasswordChange from './components/ForcePasswordChange'
import LoginForm from './components/LoginForm'
import SetupForm from './components/SetupForm'
import UndecryptableSecretsBanner from './components/UndecryptableSecretsBanner'
import { useAuth } from './hooks/useAuth'
import { isGlobalAdmin, useScope } from './hooks/useScope'
import { useTheme } from './hooks/useTheme'
import wordmarkDark from './assets/wordmark-dark.svg'
import wordmarkLight from './assets/wordmark-light.svg'

export default function App() {
  const auth = useAuth()
  // Thread the active user id into useScope so the sidebar's
  // role-gated entries (e.g. Backup) update immediately on a
  // login/logout cycle instead of waiting for a manual refresh.
  // null covers both "auth still loading" and "no session" — the
  // App returns its own loading spinner before any scope-gated
  // chrome would render, so deferring the scope fetch until the
  // user resolves keeps the initial load to one round-trip per
  // identity.
  const userKey =
    auth.state.kind === 'ready' &&
    auth.state.status.authenticated &&
    auth.state.status.user
      ? auth.state.status.user.id
      : null
  const scope = useScope(userKey)
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()

  const serverTheme =
    auth.state.kind === 'ready' ? auth.state.status.user?.theme : undefined
  const [theme] = useTheme(serverTheme)

  if (auth.state.kind === 'loading') {
    return (
      <Bullseye style={{ height: '100vh' }}>
        <Spinner />
      </Bullseye>
    )
  }

  if (auth.state.kind === 'error') {
    return (
      <PageSection>
        <Alert variant="danger" title="Could not reach backend" isInline>
          {auth.state.message}
        </Alert>
      </PageSection>
    )
  }

  const status = auth.state.status

  if (status.setupRequired) {
    return <SetupForm onSetup={auth.setup} />
  }

  if (!status.authenticated || !status.user) {
    return <LoginForm onLogin={auth.login} onTotpComplete={auth.refresh} />
  }

  const user = status.user

  if (user.mustChangePassword) {
    return (
      <ForcePasswordChange
        username={user.username}
        onChanged={() => auth.refresh()}
      />
    )
  }

  const onSelectMenu = (
    _event?: React.MouseEvent<Element, MouseEvent>,
    value?: string | number,
  ) => {
    setMenuOpen(false)
    if (value === 'profile') {
      navigate('/profile')
    } else if (value === 'logout') {
      void auth.logout()
    }
  }

  const userMenu = (
    <Dropdown
      isOpen={menuOpen}
      onSelect={onSelectMenu}
      onOpenChange={(open: boolean) => setMenuOpen(open)}
      toggle={(ref: React.Ref<MenuToggleElement>) => (
        <MenuToggle
          ref={ref}
          isExpanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="User menu"
        >
          {user.username}
        </MenuToggle>
      )}
    >
      <DropdownList>
        <DropdownItem value="profile" key="profile">
          Profile
        </DropdownItem>
        <DropdownItem value="logout" key="logout">
          Sign out
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  )

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <MastheadLogo
            style={
              {
                '--pf-v6-c-masthead__logo--Width': '11rem',
                '--pf-v6-c-masthead__logo--MaxHeight': '5rem',
              } as React.CSSProperties
            }
          >
            <img
              src={theme === 'dark' ? wordmarkDark : wordmarkLight}
              alt="System Wrangler"
              style={{ height: '5rem', width: 'auto', display: 'block' }}
            />
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem align={{ default: 'alignEnd' }}>{userMenu}</ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  )

  const sidebar = <Sidebar isGlobalAdmin={isGlobalAdmin(scope.state)} />

  return (
    <Page
      masthead={masthead}
      sidebar={sidebar}
      style={
        {
          // Override PatternFly's default 18.125rem sidebar width.
          // The grid-template-columns rule that consumes this var
          // lives on `.pf-v6-c-page` (the Page component itself),
          // so setting it on PageSidebar has no effect — it has to
          // be on the Page. Two-thirds frees horizontal space the
          // primary content was feeling compressed for; the nav
          // labels still fit comfortably in 12rem.
          '--pf-v6-c-page__sidebar--Width--base': '12rem',
        } as React.CSSProperties
      }
    >
      {isGlobalAdmin(scope.state) && (
        <PageSection>
          <UndecryptableSecretsBanner
            onNavigateToUsers={() => navigate('/users')}
          />
        </PageSection>
      )}
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/systems" element={<SystemsPage />} />
        <Route path="/systems/:systemId" element={<SystemDetailPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
        <Route path="/users" element={<UsersPage currentUserId={user.id} />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route
          path="/backup"
          element={
            isGlobalAdmin(scope.state) ? <BackupPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="/credentials"
          element={
            isGlobalAdmin(scope.state) ? <CredentialsPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="/updaters"
          element={
            isGlobalAdmin(scope.state) ? <UpdatersPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="/exporters"
          element={
            isGlobalAdmin(scope.state) ? <ExportersPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="/exclusions"
          element={
            isGlobalAdmin(scope.state) ? <ExclusionsPage /> : <Navigate to="/" replace />
          }
        />
        <Route path="/monitoring/systems-overview" element={<SystemsOverviewPage />} />
        <Route path="/monitoring/system-graphs" element={<SystemGraphsPage />} />
        <Route
          path="/settings"
          element={
            isGlobalAdmin(scope.state) ? <SettingsPage /> : <Navigate to="/" replace />
          }
        />
        <Route
          path="/profile"
          element={
            <ProfilePage
              user={user}
              onProfileUpdate={() => {
                void auth.refresh()
              }}
              onAuthChange={() => {
                void auth.refresh()
              }}
            />
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Page>
  )
}

// Sidebar groups the secondary nav into collapsible NavExpandable
// sections. A section auto-expands when the current route lives
// inside it so a returning user lands with their place visible.
// Tracking the section state locally (rather than letting
// NavExpandable manage it internally) means a user-driven toggle
// still wins even after a route change — without this, navigating
// inside a section the user had just collapsed would re-expand it.
function Sidebar({ isGlobalAdmin }: { isGlobalAdmin: boolean }) {
  const { pathname } = useLocation()
  const isInventoryRoute =
    pathname === '/systems' ||
    pathname.startsWith('/systems/') ||
    pathname === '/groups' ||
    pathname.startsWith('/groups/')
  const isMonitoringRoute = pathname.startsWith('/monitoring/')
  const adminPaths = [
    '/users',
    '/audit',
    '/credentials',
    '/updaters',
    '/exporters',
    '/exclusions',
    '/backup',
    '/settings',
  ]
  const isAdminRoute = adminPaths.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )

  const [inventoryOpen, setInventoryOpen] = useState(isInventoryRoute)
  const [monitoringOpen, setMonitoringOpen] = useState(isMonitoringRoute)
  const [adminOpen, setAdminOpen] = useState(isAdminRoute)

  // Auto-expand the owning section *on* a route transition, not on
  // every render that happens to share a route — otherwise a user
  // who collapses the section while viewing one of its pages would
  // see it pop back open on every re-render. Tracking the previous
  // pathname lets us fire the adjustment exactly once per navigation.
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    if (isInventoryRoute) setInventoryOpen(true)
    if (isMonitoringRoute) setMonitoringOpen(true)
    if (isAdminRoute) setAdminOpen(true)
  }

  return (
    <PageSidebar>
      <PageSidebarBody>
        <Nav aria-label="Primary">
          <NavList>
            <RouterNavItem to="/" end>
              Dashboard
            </RouterNavItem>
            <NavExpandable
              title="Inventory"
              isExpanded={inventoryOpen}
              isActive={isInventoryRoute}
              onExpand={(_e, val) => setInventoryOpen(val)}
            >
              <RouterNavItem to="/systems">Systems</RouterNavItem>
              <RouterNavItem to="/groups">System Groups</RouterNavItem>
            </NavExpandable>
            <NavExpandable
              title="Monitoring"
              isExpanded={monitoringOpen}
              isActive={isMonitoringRoute}
              onExpand={(_e, val) => setMonitoringOpen(val)}
            >
              <RouterNavItem to="/monitoring/systems-overview">
                Systems overview
              </RouterNavItem>
              <RouterNavItem to="/monitoring/system-graphs">
                System graphs
              </RouterNavItem>
            </NavExpandable>
            <NavExpandable
              title="Administration"
              isExpanded={adminOpen}
              isActive={isAdminRoute}
              onExpand={(_e, val) => setAdminOpen(val)}
            >
              <RouterNavItem to="/users">Users</RouterNavItem>
              <RouterNavItem to="/audit">Audit</RouterNavItem>
              {isGlobalAdmin && (
                <RouterNavItem to="/credentials">Credentials</RouterNavItem>
              )}
              {isGlobalAdmin && (
                <RouterNavItem to="/updaters">Updaters</RouterNavItem>
              )}
              {isGlobalAdmin && (
                <RouterNavItem to="/exporters">Exporters</RouterNavItem>
              )}
              {isGlobalAdmin && (
                <RouterNavItem to="/exclusions">Exclusions</RouterNavItem>
              )}
              {isGlobalAdmin && (
                <RouterNavItem to="/backup">Backup</RouterNavItem>
              )}
              {isGlobalAdmin && (
                <RouterNavItem to="/settings">Settings</RouterNavItem>
              )}
            </NavExpandable>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )
}

// RouterNavItem keeps the sidebar's anchor real (so right-click
// "open in new tab" produces a sane URL) while intercepting the
// normal click to navigate client-side without a full reload. `end`
// mirrors NavLink's exact-match semantics: only the root needs it,
// the rest match by prefix so deep routes like /groups/:id keep
// their parent active.
function RouterNavItem({
  to,
  end = false,
  children,
}: {
  to: string
  end?: boolean
  children: ReactNode
}) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(to + '/')
  return (
    <NavItem
      isActive={isActive}
      to={to}
      onClick={(e) => {
        // Let modified clicks fall through to the browser so
        // ⌘-click / middle-click / right-click → new tab still
        // work. Plain left-click is intercepted for client-side
        // routing.
        const ev = e as unknown as React.MouseEvent
        if (ev.defaultPrevented) return
        if (ev.button !== 0) return
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
        ev.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </NavItem>
  )
}
