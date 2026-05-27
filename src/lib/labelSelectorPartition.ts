// SPDX-License-Identifier: Apache-2.0

import type { Label } from '../api/labels'
import type { SystemStatus } from '../api/systems'

// Matchable is the slice of System the substring fallback needs:
// just the status (for chip text) and the labels list.
export type Matchable = {
  status: SystemStatus
  labels?: Label[]
}

// GRAMMAR_PATTERN identifies any character or keyword that means the
// caller is writing selector grammar rather than a substring lookup.
// `,` `(` `)` `=` `!` plus the keywords `in` / `notin` (surrounded by
// whitespace so we don't false-positive on identifiers that happen to
// start with "in", e.g. `inventory`).
const GRAMMAR_PATTERN = /[=!,()]|\s(?:in|notin)\s/i

// interpretLabelInput is the unified entry point the pages use to
// decide what to send to the backend and how to filter rows
// client-side. Two modes:
//
// 1. **Grammar** — when the input contains any selector marker (`=`,
//    `!`, `,`, `(`, `)`, or the word `in`/`notin` between spaces),
//    treat as a label selector. partitionSelector handles the
//    backend half + the synthetic `status` requirements; the rest
//    flows through `?labels=` to the API.
// 2. **Substring** — when the input is a plain word with no grammar
//    markers, match it as a case-insensitive substring against every
//    chip's text on each row (status display + user labels formatted
//    as `key=value` or bare `key`). Mirrors the pre-selector UX
//    where typing "reach" filtered to Reachable rows.
export function interpretLabelInput(input: string): {
  backend: string
  matches: (row: Matchable) => boolean
} {
  const trimmed = input.trim()
  if (trimmed === '') {
    return { backend: '', matches: () => true }
  }
  if (GRAMMAR_PATTERN.test(trimmed)) {
    const { backend, statusFilter } = partitionSelector(trimmed)
    return { backend, matches: (row) => statusFilter(row.status) }
  }
  const needle = trimmed.toLowerCase()
  return {
    backend: '',
    matches: (row) => substringMatches(row, needle),
  }
}

// substringMatches checks whether `needle` appears (case-insensitive)
// inside the row's status text or any of its label chips. Labels
// render as `key=value` for k=v and bare `key` for null values, so
// matching against those exact strings keeps "what you see is what
// you can match" honest.
function substringMatches(row: Matchable, needle: string): boolean {
  if (row.status.toLowerCase().includes(needle)) return true
  for (const l of row.labels ?? []) {
    const text = l.value === null ? l.key : `${l.key}=${l.value}`
    if (text.toLowerCase().includes(needle)) return true
  }
  return false
}

// partitionSelector splits a label-selector input into the half the
// backend understands (real labels in the system_labels table) and a
// client-side predicate for the synthetic `status` key — the system's
// probe outcome (reachable / unreachable / unprobed). Status isn't
// stored in system_labels so the backend can't filter by it; the SPA
// strips status requirements out and applies them in-memory after the
// fetch.
//
// Bare status-name shorthand (`reachable`, `unreachable`, `unprobed`,
// case-insensitive) is treated as `status=<value>` so the old "type
// the status text" filter still works.
export function partitionSelector(input: string): {
  backend: string
  statusFilter: (s: SystemStatus) => boolean
} {
  const tokens = tokenizeSelector(input)
  const backend: string[] = []
  const statusPreds: ((s: SystemStatus) => boolean)[] = []
  for (const tok of tokens) {
    const pred = parseStatusToken(tok)
    if (pred) statusPreds.push(pred)
    else backend.push(tok)
  }
  return {
    backend: backend.join(','),
    statusFilter:
      statusPreds.length === 0
        ? () => true
        : (s) => statusPreds.every((p) => p(s)),
  }
}

const STATUS_NAMES: SystemStatus[] = ['reachable', 'unreachable', 'unprobed']

// tokenizeSelector splits the input on top-level commas, skipping
// commas inside parentheses so `status in (a,b)` stays a single
// requirement instead of fragmenting into two backend tokens.
function tokenizeSelector(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      out.push(input.slice(start, i))
      start = i + 1
    }
  }
  out.push(input.slice(start))
  return out.map((t) => t.trim()).filter(Boolean)
}

// parseStatusToken returns a predicate when the token references the
// synthetic `status` key (or is a bare status-name shorthand), or null
// when the token belongs to the backend selector.
function parseStatusToken(
  tok: string,
): ((s: SystemStatus) => boolean) | null {
  // status in (...)
  const inM = /^status\s+in\s*\(\s*([^)]*)\s*\)$/i.exec(tok)
  if (inM) {
    const vals = inM[1]
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    return (s) => vals.includes(s)
  }
  // status notin (...)
  const ninM = /^status\s+notin\s*\(\s*([^)]*)\s*\)$/i.exec(tok)
  if (ninM) {
    const vals = ninM[1]
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    return (s) => !vals.includes(s)
  }
  // status=X
  const eqM = /^status\s*=\s*(.*)$/.exec(tok)
  if (eqM) {
    const want = eqM[1].trim().toLowerCase()
    return (s) => s === want
  }
  // status!=X
  const neqM = /^status\s*!=\s*(.*)$/.exec(tok)
  if (neqM) {
    const want = neqM[1].trim().toLowerCase()
    return (s) => s !== want
  }
  // bare !status — status is always set on a system row, so this
  // matches nothing
  if (/^!\s*status$/.test(tok)) return () => false
  // bare status — always matches
  if (/^status$/.test(tok)) return () => true
  // Bare status-name shorthand: typing "reachable" filters as if the
  // user wrote "status=reachable". Preserves the pre-selector UX
  // where the column filter took status text directly.
  const lower = tok.toLowerCase()
  if ((STATUS_NAMES as string[]).includes(lower)) {
    return (s) => s === lower
  }
  return null
}
