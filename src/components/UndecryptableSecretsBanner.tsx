// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import { Alert, AlertActionLink } from '@patternfly/react-core'
import {
  fetchUndecryptableSecrets,
  type UndecryptableScan,
} from '../api/secrets'

// labelForField turns the bare backend `field` token into something
// readable. Kept tiny because we only have two values today; expand
// when ansible / oidc sources land.
function labelForField(kind: string, field: string): string {
  if (kind === 'user_totp' && field === 'secret') return 'authenticator secret'
  if (kind === 'user_totp' && field === 'pending') return 'pending TOTP enrollment'
  return `${kind} / ${field}`
}

type Props = {
  // onNavigateToUsers, when set, becomes an action link in the
  // banner that hops the operator to the Users page where the
  // matching 2FA reset action lives. Null disables the link entirely.
  onNavigateToUsers?: () => void
}

type State =
  | { kind: 'idle' }
  | { kind: 'ready'; scan: UndecryptableScan }

// UndecryptableSecretsBanner is mounted at app root for Global
// Admins. It scans the backend for sealed-at-rest columns the
// running master key can't open — the canonical trigger is a DB
// restore against a mismatched SW_MASTER_KEY_FILE. Renders nothing
// in idle / empty states so the chrome doesn't carry empty alerts.
export default function UndecryptableSecretsBanner({
  onNavigateToUsers,
}: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    fetchUndecryptableSecrets()
      .then((scan) => {
        if (!cancelled) setState({ kind: 'ready', scan })
      })
      .catch(() => {
        // The endpoint is Global-Admin-gated. The caller already
        // checks scope before mounting the banner, so a 403 here
        // is a race with a role revocation — silently skip. Any
        // network or 5xx error is also non-fatal; the operator can
        // refresh later.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind !== 'ready' || state.scan.count === 0) return null

  const title =
    state.scan.count === 1
      ? '1 encrypted secret cannot be decrypted with the current master key.'
      : `${state.scan.count} encrypted secrets cannot be decrypted with the current master key.`

  return (
    <Alert
      variant="danger"
      title={title}
      isInline
      actionLinks={
        onNavigateToUsers && (
          <AlertActionLink onClick={onNavigateToUsers}>
            Open Users page
          </AlertActionLink>
        )
      }
    >
      <p>
        Restore the matching <code>SW_MASTER_KEY_FILE</code>, or re-enroll
        the affected accounts. From the Users page, reset 2FA for each
        affected user and have them enroll again.
      </p>
      <ul style={{ marginTop: 8, marginLeft: 16 }}>
        {state.scan.items.map((item) => (
          <li key={`${item.kind}:${item.targetId}:${item.field}`}>
            <strong>{item.targetLabel}</strong>
            {' — '}
            {labelForField(item.kind, item.field)}
            {' (key version '}
            {item.keyVersion}
            {')'}
          </li>
        ))}
      </ul>
    </Alert>
  )
}
