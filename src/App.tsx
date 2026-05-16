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
  NavGroup,
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
import CredentialsPage from './pages/CredentialsPage'
import DashboardPage from './pages/DashboardPage'
import GroupDetailPage from './pages/GroupDetailPage'
import GroupsPage from './pages/GroupsPage'
import NotFoundPage from './pages/NotFoundPage'
import ProfilePage from './pages/ProfilePage'
import SystemsPage from './pages/SystemsPage'
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

  const sidebar = (
    <PageSidebar>
      <PageSidebarBody>
        <Nav aria-label="Primary">
          <NavList>
            <RouterNavItem to="/" end>
              Dashboard
            </RouterNavItem>
          </NavList>
          <NavGroup title="Inventory">
            <RouterNavItem to="/systems">Systems</RouterNavItem>
            <RouterNavItem to="/groups">System Groups</RouterNavItem>
          </NavGroup>
          <NavGroup title="Administration">
            <RouterNavItem to="/users">Users</RouterNavItem>
            <RouterNavItem to="/audit">Audit</RouterNavItem>
            {isGlobalAdmin(scope.state) && (
              <RouterNavItem to="/credentials">Credentials</RouterNavItem>
            )}
            {isGlobalAdmin(scope.state) && (
              <RouterNavItem to="/backup">Backup</RouterNavItem>
            )}
          </NavGroup>
          {/* Reserved for alerts, custom dashboards, and reports once those
              land; rendered now so the structure of the sidebar is visible. */}
          <NavGroup title="Monitoring" />
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  return (
    <Page masthead={masthead} sidebar={sidebar}>
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
