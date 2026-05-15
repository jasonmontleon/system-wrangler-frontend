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
import BackupPage from './pages/BackupPage'
import DashboardPage from './pages/DashboardPage'
import GroupDetailPage from './pages/GroupDetailPage'
import GroupsPage from './pages/GroupsPage'
import ProfilePage from './pages/ProfilePage'
import SystemsPage from './pages/SystemsPage'
import UsersPage from './pages/UsersPage'
import type { Group } from './api/groups'
import ForcePasswordChange from './components/ForcePasswordChange'
import LoginForm from './components/LoginForm'
import SetupForm from './components/SetupForm'
import UndecryptableSecretsBanner from './components/UndecryptableSecretsBanner'
import { useAuth } from './hooks/useAuth'
import { isGlobalAdmin, useScope } from './hooks/useScope'
import { useTheme } from './hooks/useTheme'
import wordmarkDark from './assets/wordmark-dark.svg'
import wordmarkLight from './assets/wordmark-light.svg'

type PageKey =
  | 'dashboard'
  | 'systems'
  | 'groups'
  | 'group-detail'
  | 'users'
  | 'audit'
  | 'backup'
  | 'profile'

export default function App() {
  const auth = useAuth()
  const scope = useScope()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState<Group | null>(null)

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
            <NavItem
              isActive={page === 'groups' || page === 'group-detail'}
              onClick={() => {
                setActiveGroup(null)
                setPage('groups')
              }}
              to="#"
            >
              System Groups
            </NavItem>
          </NavGroup>
          <NavGroup title="Administration">
            <NavItem
              isActive={page === 'users'}
              onClick={() => setPage('users')}
              to="#"
            >
              Users
            </NavItem>
            <NavItem
              isActive={page === 'audit'}
              onClick={() => setPage('audit')}
              to="#"
            >
              Audit
            </NavItem>
            {isGlobalAdmin(scope.state) && (
              <NavItem
                isActive={page === 'backup'}
                onClick={() => setPage('backup')}
                to="#"
              >
                Backup
              </NavItem>
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
            onNavigateToUsers={() => setPage('users')}
          />
        </PageSection>
      )}
      {page === 'dashboard' && <DashboardPage />}
      {page === 'systems' && <SystemsPage />}
      {page === 'groups' && (
        <GroupsPage
          onOpenGroup={(g) => {
            setActiveGroup(g)
            setPage('group-detail')
          }}
        />
      )}
      {page === 'group-detail' && activeGroup && (
        <GroupDetailPage
          group={activeGroup}
          onBack={() => {
            setActiveGroup(null)
            setPage('groups')
          }}
        />
      )}
      {page === 'users' && <UsersPage currentUserId={user.id} />}
      {page === 'audit' && <AuditPage />}
      {page === 'backup' && isGlobalAdmin(scope.state) && <BackupPage />}
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
