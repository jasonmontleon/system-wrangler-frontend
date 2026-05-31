// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { DashboardContext, type DashboardContextValue } from './dashboardContext'

export function DashboardProvider({
  value,
  children,
}: {
  value: DashboardContextValue
  children: ReactNode
}) {
  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  )
}
