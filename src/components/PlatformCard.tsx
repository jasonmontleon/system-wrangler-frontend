// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import {
  Alert,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Content,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import { setSystemPlatform, type System } from '../api/systems'

type Props = {
  system: System
  canEdit: boolean
  onChange: () => void | Promise<void>
}

// PlatformCard surfaces the operator-declared Windows flag. The flag
// flips the Ansible inventory to ansible_shell_type=powershell and the
// ad-hoc Ping module to ansible.windows.win_ping; everything else
// (key file, host keys, credentials resolution) is unchanged.
export default function PlatformCard({ system, canEdit, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onToggle = async (next: boolean) => {
    setError(null)
    setBusy(true)
    try {
      await setSystemPlatform(system.id, next)
      await onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardTitle>Platform</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <Checkbox
              id={`platform-windows-${system.id}`}
              label="This system runs Windows"
              isChecked={!!system.isWindows}
              isDisabled={!canEdit || busy}
              onChange={(_, v) => void onToggle(v)}
            />
          </StackItem>
          <StackItem>
            <Content component="small">
              When checked, the Ansible runner uses
              ansible_shell_type=powershell in the inventory and ansible.windows
              modules (win_ping, win_command). Leave unchecked for Linux,
              macOS, and BSD hosts.
            </Content>
          </StackItem>
          <StackItem>
            <Content component="small">
              <strong>Windows host prerequisite:</strong> the OpenSSH default
              shell must be PowerShell, not cmd.exe (the Windows default).
              Run on the target once:
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: '0.25rem 0 0',
                  fontSize: '0.85rem',
                }}
              >
                {`New-ItemProperty -Path "HKLM:\\SOFTWARE\\OpenSSH" \`
  -Name DefaultShell \`
  -Value "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" \`
  -PropertyType String -Force
Restart-Service sshd`}
              </pre>
            </Content>
          </StackItem>
          {error && (
            <StackItem>
              <Alert variant="danger" isInline title="Could not update platform">
                {error}
              </Alert>
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}
