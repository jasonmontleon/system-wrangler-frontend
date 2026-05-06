// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react'
import {
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
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import DashboardPage from './pages/DashboardPage'
import HostsPage from './pages/HostsPage'

// AGPL §13 requires running instances to prominently offer source to remote
// users. Override at build time via VITE_SOURCE_URL; the default points at
// the upstream project so forks must update it.
const SOURCE_URL =
  import.meta.env.VITE_SOURCE_URL ?? 'https://github.com/example/cat-wrangler'

type PageKey = 'dashboard' | 'hosts'

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard')

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <MastheadLogo>Cat Wrangler</MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                Source
              </a>
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
              isActive={page === 'hosts'}
              onClick={() => setPage('hosts')}
              to="#"
            >
              Hosts
            </NavItem>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  return (
    <Page masthead={masthead} sidebar={sidebar}>
      {page === 'dashboard' && <DashboardPage />}
      {page === 'hosts' && <HostsPage />}
    </Page>
  )
}
