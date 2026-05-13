// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
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
import AuditPage from './pages/AuditPage'
import DashboardPage from './pages/DashboardPage'
import ProfilePage from './pages/ProfilePage'
import SystemsPage from './pages/SystemsPage'
import LoginForm from './components/LoginForm'
import SetupForm from './components/SetupForm'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'

type PageKey = 'dashboard' | 'systems' | 'audit' | 'profile'

export default function App() {
  const auth = useAuth()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)

  const serverTheme =
    auth.state.kind === 'ready' ? auth.state.status.user?.theme : undefined
  useTheme(serverTheme)

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

  const onSelectMenu = (
    _event?: React.MouseEvent<Element, MouseEvent>,
    value?: string | number,
  ) => {
    setMenuOpen(false)
    if (value === 'profile') {
      setPage('profile')
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
          <MastheadLogo>System Wrangler</MastheadLogo>
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
            <NavItem
              isActive={page === 'dashboard'}
              onClick={() => setPage('dashboard')}
              to="#"
            >
              Dashboard
            </NavItem>
          </NavList>
          <NavGroup title="Inventory">
            <NavItem
              isActive={page === 'systems'}
              onClick={() => setPage('systems')}
              to="#"
            >
              Systems
            </NavItem>
          </NavGroup>
          <NavGroup title="Administration">
            <NavItem
              isActive={page === 'audit'}
              onClick={() => setPage('audit')}
              to="#"
            >
              Audit
            </NavItem>
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
      {page === 'dashboard' && <DashboardPage />}
      {page === 'systems' && <SystemsPage />}
      {page === 'audit' && <AuditPage />}
      {page === 'profile' && (
        <ProfilePage
          user={user}
          onProfileUpdate={() => {
            void auth.refresh()
          }}
          onAuthChange={() => {
            void auth.refresh()
          }}
        />
      )}
    </Page>
  )
}
