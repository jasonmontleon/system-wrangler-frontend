// SPDX-License-Identifier: Apache-2.0

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOURCE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
