// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  PageSection,
  Stack,
  StackItem,
  Title,
} from '@patternfly/react-core'
import { requestBackup } from '../api/backup'
import { ApiError } from '../api/systems'
import { formatBytes } from '../util/format'

// triggerDownload is split out so the component renders without DOM
// side effects under jsdom and the integration test can stub it. Real
// browsers handle URL.createObjectURL + anchor click reliably; jsdom
// doesn't ship a Blob URL implementation.
export type DownloadTrigger = (blob: Blob, filename: string) => void

const defaultDownload: DownloadTrigger = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

type Props = {
  // download is injected by tests; production callers leave it
  // unset and the default browser-anchor implementation is used.
  download?: DownloadTrigger
}

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; filename: string; bytes: number }
  | { kind: 'error'; message: string }

export default function BackupPage({ download = defaultDownload }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const onDownload = async () => {
    setState({ kind: 'running' })
    try {
      const { blob, filename } = await requestBackup()
      download(blob, filename)
      setState({ kind: 'done', filename, bytes: blob.size })
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      setState({ kind: 'error', message: msg })
    }
  }

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Backup</Title>
      </PageSection>
      <PageSection>
        <Stack hasGutter>
          <StackItem>
            <Alert variant="warning" title="Two files, separate media" isInline>
              <p>
                A System Wrangler backup is two files: the database (this
                download) and the master key (set via{' '}
                <code>SW_MASTER_KEY_FILE</code>). Back them up separately and
                store them on separate media.
              </p>
              <p style={{ marginTop: 8 }}>
                Restoring with a mismatched key permanently loses every
                encrypted secret. System Wrangler does not bundle them and
                does not recover from losing the key.
              </p>
            </Alert>
          </StackItem>
          <StackItem>
            <Card>
              <CardTitle>Download database snapshot</CardTitle>
              <CardBody>
                <Stack hasGutter>
                  <StackItem>
                    Produces a fresh, consistent <code>.db</code> file via{' '}
                    <code>VACUUM INTO</code>. The live process is briefly
                    blocked while the snapshot pages are copied; at homelab
                    scale the window is sub-second.
                  </StackItem>
                  <StackItem>
                    Restore is an offline procedure: stop the container,
                    replace <code>system-wrangler.db</code> with the
                    downloaded file, ensure <code>SW_MASTER_KEY_FILE</code>
                    points at the same key that was active when the backup
                    was taken, and restart.
                  </StackItem>
                  <StackItem>
                    <Button
                      variant="primary"
                      onClick={() => void onDownload()}
                      isLoading={state.kind === 'running'}
                      isDisabled={state.kind === 'running'}
                    >
                      Download backup
                    </Button>
                  </StackItem>
                  {state.kind === 'done' && (
                    <StackItem>
                      <Alert
                        variant="success"
                        title="Backup downloaded"
                        isInline
                      >
                        Saved {state.filename} ({formatBytes(state.bytes)}).
                      </Alert>
                    </StackItem>
                  )}
                  {state.kind === 'error' && (
                    <StackItem>
                      <Alert
                        variant="danger"
                        title="Backup failed"
                        isInline
                      >
                        {state.message}
                      </Alert>
                    </StackItem>
                  )}
                </Stack>
              </CardBody>
            </Card>
          </StackItem>
        </Stack>
      </PageSection>
    </>
  )
}

