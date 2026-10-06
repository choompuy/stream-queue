#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// Get all .ts files recursively
function getTsFiles(dir) {
  const files = []
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...getTsFiles(fullPath))
    } else if (entry.name.endsWith('.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

function rewriteImports(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  let newContent = content
  let modified = false

  // Add prefixes for the future structure
  const replacements = [
    // Core files
    ["from './activity.js'", "from './core/activity.js'"],
    ["from './blocklist.js'", "from './core/blocklist.js'"],
    ["from './config.js'", "from './core/config.js'"],
    ["from './fallback.js'", "from './core/fallback.js'"],
    ["from './finish.js'", "from './core/finish.js'"],
    ["from './i18n.js'", "from './core/i18n.js'"],
    ["from './player.js'", "from './core/player.js'"],
    ["from './playlists.js'", "from './core/playlists.js'"],
    ["from './queue.js'", "from './core/queue.js'"],
    ["from './settings.js'", "from './core/settings.js'"],
    ["from './state-file.js'", "from './core/state-file.js'"],
    ["from './types.js'", "from './core/types.js'"],

    // Infra files
    ["from './config-helper.js'", "from './infra/config-helper.js'"],
    ["from './logger.js'", "from './infra/logger.js'"],
    ["from './persist.js'", "from './infra/persist.js'"],
    ["from './port.js'", "from './infra/port.js'"],
    ["from './runtime.js'", "from './infra/runtime.js'"],
    ["from './secrets.js'", "from './infra/secrets.js'"],
    ["from './server-config.js'", "from './infra/server-config.js'"],
    ["from './shutdown.js'", "from './infra/shutdown.js'"],
    ["from './state-events.js'", "from './infra/state-events.js'"],

    // Web files
    ["from './error-handler.js'", "from './web/error-handler.js'"],
    ["from './host-check.js'", "from './web/host-check.js'"],
    ["from './http.js'", "from './web/http.js'"],
    ["from './local-only.js'", "from './web/local-only.js'"],
    ["from './rate-limit.js'", "from './web/rate-limit.js'"],
    ["from './sse.js'", "from './web/sse.js'"],

    // Directories
    ["from './youtube/", "from './integrations/youtube/"],
    ["from './routes/", "from './web/routes/"],
  ]

  for (const [old, newStr] of replacements) {
    if (newContent.includes(old)) {
      newContent = newContent.split(old).join(newStr)
      modified = true
    }
  }

  if (modified) {
    writeFileSync(filePath, newContent, 'utf-8')
    console.log(`Rewrote: ${relative(projectRoot, filePath)}`)
  }

  return modified
}

// Process all .ts files in src/ and tests/
const srcFiles = getTsFiles(join(projectRoot, 'src'))
const testFiles = getTsFiles(join(projectRoot, 'tests'))
const allFiles = [...srcFiles, ...testFiles]

let count = 0
for (const file of allFiles) {
  if (rewriteImports(file)) {
    count++
  }
}

console.log(`\nRewrote ${count} files`)
