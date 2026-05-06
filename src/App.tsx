// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  Nav,
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
import { MoonIcon, SunIcon } from '@patternfly/react-icons'
import DashboardPage from './pages/DashboardPage'
import SystemsPage from './pages/SystemsPage'
import LoginForm from './components/LoginForm'
import SetupForm from './components/SetupForm'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'

// AGPL §13 requires running instances to prominently offer source to remote
// users. Override at build time via VITE_SOURCE_URL; the default points at
// the upstream project so forks must update it.
const SOURCE_URL =
  import.meta.env.VITE_SOURCE_URL ?? 'https://github.com/example/system-wrangler'

type PageKey = 'dashboard' | 'systems'

export default function App() {
  const auth = useAuth()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [theme, setTheme] = useTheme()
  const isDark = theme === 'dark'

  const themeButton = (
    <Button
      variant="plain"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      icon={isDark ? <SunIcon /> : <MoonIcon />}
    />
  )

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

  if (!status.authenticated) {
    return <LoginForm onLogin={auth.login} />
  }

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
            <ToolbarItem align={{ default: 'alignEnd' }}>{themeButton}</ToolbarItem>
            <ToolbarItem>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                Source
              </a>
            </ToolbarItem>
            {status.user && (
              <ToolbarItem>
                <span aria-label="signed in as">{status.user.username}</span>
              </ToolbarItem>
            )}
            <ToolbarItem>
              <Button variant="link" onClick={() => void auth.logout()}>
                Sign out
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  )

  const sidebar = (
    <PageSidebar>
      <PageSidebarBody>
        <Nav>
          <NavList>
            <NavItem
              isActive={page === 'dashboard'}
              onClick={() => setPage('dashboard')}
              to="#"
            >
              Dashboard
            </NavItem>
            <NavItem
              isActive={page === 'systems'}
              onClick={() => setPage('systems')}
              to="#"
            >
              Systems
            </NavItem>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  return (
    <Page masthead={masthead} sidebar={sidebar}>
      {page === 'dashboard' && <DashboardPage />}
      {page === 'systems' && <SystemsPage />}
    </Page>
  )
}
