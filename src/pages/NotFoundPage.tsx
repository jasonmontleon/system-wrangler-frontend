// SPDX-License-Identifier: Apache-2.0

import {
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageSection,
} from '@patternfly/react-core'
import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <PageSection>
      <EmptyState titleText="Page not found" headingLevel="h1">
        <EmptyStateBody>
          The URL you tried to open doesn&apos;t match any known view in
          System Wrangler.
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Link to="/">Back to dashboard</Link>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    </PageSection>
  )
}
