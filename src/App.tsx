// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react'
import {
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSection,
  PageSidebar,
  PageSidebarBody,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'

// AGPL §13 requires running instances to prominently offer source to remote
// users. Override at build time via VITE_SOURCE_URL; the default points at
// the upstream project so forks must update it.
const SOURCE_URL =
  import.meta.env.VITE_SOURCE_URL ?? 'https://github.com/example/cat-wrangler'

type Health = { status: string }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)))
  }, [])

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
            <NavItem isActive>Dashboard</NavItem>
            <NavItem>Hosts</NavItem>
            <NavItem>Updates</NavItem>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  return (
    <Page masthead={masthead} sidebar={sidebar}>
      <PageSection>
        <Title headingLevel="h1">Dashboard</Title>
      </PageSection>
      <PageSection>
        <Card>
          <CardTitle>Backend health</CardTitle>
          <CardBody>
            {error && <span>error: {error}</span>}
            {!error && !health && (
              <Bullseye>
                <Spinner />
              </Bullseye>
            )}
            {health && <span>status: {health.status}</span>}
          </CardBody>
        </Card>
      </PageSection>
    </Page>
  )
}
