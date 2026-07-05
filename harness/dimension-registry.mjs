#!/usr/bin/env node
/*
 * dimension-registry.mjs — the ONE canonical source of valid audit-dimension keys:
 * the `methodology/dimensions/*.md` basenames. No hardcoded list — a new dimension
 * file IS its registration. Consumers: build-audit-engine.mjs (hard gate on
 * scope-input keys, applicable + N/A alike) and render-target-map.mjs (display
 * belt for a hand-written target-map.json).
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/** The Set of known dimension keys under <pluginRoot>/methodology/dimensions/. */
export function knownDimensionKeys(pluginRoot) {
  return new Set(
    readdirSync(join(pluginRoot, 'methodology', 'dimensions'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3))
  )
}
