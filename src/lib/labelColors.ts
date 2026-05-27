// SPDX-License-Identifier: Apache-2.0

import {
  ALL_LABEL_COLORS,
  type LabelColor,
  type LabelStyleMap,
} from '../api/labelStyles'

// colorFor returns the chip color for a user label using the hybrid
// model: persisted overrides win, otherwise the label key is hashed
// into ALL_LABEL_COLORS. Hashing on the key (not key=value) keeps every
// `env=*` chip the same color, which matches the dominant operator
// expectation.
export function colorFor(
  key: string,
  overrides?: LabelStyleMap,
): LabelColor {
  if (overrides && key in overrides) {
    return overrides[key]
  }
  return hashColor(key)
}

// hashColor is a tiny djb2-style hash → palette index. Pure function,
// deterministic across reloads and across systems. Don't substitute a
// fancier hash without rebenching first — the current chip count is
// trivial and djb2 is one multiply per byte.
function hashColor(s: string): LabelColor {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  const i = Math.abs(h) % ALL_LABEL_COLORS.length
  return ALL_LABEL_COLORS[i]
}
