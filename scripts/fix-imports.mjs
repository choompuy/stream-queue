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

function fixImports(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const relPath = relative(join(projectRoot, 'src'), filePath)

  let newContent = content
  let modified = false

  // Determine context
  const isCore = relPath.startsWith('core/')
  const isInfra = relPath.startsWith('infra/')
  const isWeb = relPath.startsWith('web/')
  const isWebRoutes = relPath.startsWith('web/routes/')
  const isIntegrations = relPath.startsWith('integrations/')
  const isIntegrationsTwitch = relPath.startsWith('integrations/twitch/')
  const isIntegrationsYoutube = relPath.startsWith('integrations/youtube/')

  const replacements = []

  if (isCore) {
    // Inside core/: ./core/ → ./
    replacements.push([/from ['"]\.\/core\//g, "from './"])
    replacements.push([/from ['"]\.\/infra\//g, "from '../infra/"])
    replacements.push([/from ['"]\.\/integrations\//g, "from '../integrations/"])
  } else if (isInfra) {
    // Inside infra/: ./infra/ → ./
    replacements.push([/from ['"]\.\/infra\//g, "from './"])
    replacements.push([/from ['"]\.\/core\//g, "from '../core/"])
    replacements.push([/from ['"]\.\/integrations\//g, "from '../integrations/"])
  } else if (isWebRoutes) {
    // Inside web/routes/: ../ → ../core/ or ../infra/ or ./
    replacements.push([/from ['"]\.\.\/types\.js['"]/g, "from '../core/types.js'"])
    replacements.push([/from ['"]\.\.\/config\.js['"]/g, "from '../core/config.js'"])
    replacements.push([/from ['"]\.\.\/activity\.js['"]/g, "from '../core/activity.js'"])
    replacements.push([/from ['"]\.\.\/blocklist\.js['"]/g, "from '../core/blocklist.js'"])
    replacements.push([/from ['"]\.\.\/fallback\.js['"]/g, "from '../core/fallback.js'"])
    replacements.push([/from ['"]\.\.\/finish\.js['"]/g, "from '../core/finish.js'"])
    replacements.push([/from ['"]\.\.\/i18n\.js['"]/g, "from '../core/i18n.js'"])
    replacements.push([/from ['"]\.\.\/player\.js['"]/g, "from '../core/player.js'"])
    replacements.push([/from ['"]\.\.\/playlists\.js['"]/g, "from '../core/playlists.js'"])
    replacements.push([/from ['"]\.\.\/queue\.js['"]/g, "from '../core/queue.js'"])
    replacements.push([/from ['"]\.\.\/settings\.js['"]/g, "from '../core/settings.js'"])
    replacements.push([/from ['"]\.\.\/state-file\.js['"]/g, "from '../core/state-file.js'"])

    replacements.push([/from ['"]\.\.\/config-helper\.js['"]/g, "from '../infra/config-helper.js'"])
    replacements.push([/from ['"]\.\.\/logger\.js['"]/g, "from '../infra/logger.js'"])
    replacements.push([/from ['"]\.\.\/persist\.js['"]/g, "from '../infra/persist.js'"])
    replacements.push([/from ['"]\.\.\/port\.js['"]/g, "from '../infra/port.js'"])
    replacements.push([/from ['"]\.\.\/runtime\.js['"]/g, "from '../infra/runtime.js'"])
    replacements.push([/from ['"]\.\.\/secrets\.js['"]/g, "from '../infra/secrets.js'"])
    replacements.push([/from ['"]\.\.\/server-config\.js['"]/g, "from '../infra/server-config.js'"])
    replacements.push([/from ['"]\.\.\/shutdown\.js['"]/g, "from '../infra/shutdown.js'"])
    replacements.push([/from ['"]\.\.\/state-events\.js['"]/g, "from '../infra/state-events.js'"])

    replacements.push([/from ['"]\.\.\/error-handler\.js['"]/g, "from './error-handler.js'"])
    replacements.push([/from ['"]\.\.\/host-check\.js['"]/g, "from './host-check.js'"])
    replacements.push([/from ['"]\.\.\/http\.js['"]/g, "from './http.js'"])
    replacements.push([/from ['"]\.\.\/local-only\.js['"]/g, "from './local-only.js'"])
    replacements.push([/from ['"]\.\.\/rate-limit\.js['"]/g, "from './rate-limit.js'"])
    replacements.push([/from ['"]\.\.\/sse\.js['"]/g, "from './sse.js'"])
  } else if (isWeb) {
    // Inside web/: ./web/ → ./
    replacements.push([/from ['"]\.\/web\//g, "from './"])
    replacements.push([/from ['"]\.\/core\//g, "from '../core/"])
    replacements.push([/from ['"]\.\/infra\//g, "from '../infra/"])
    replacements.push([/from ['"]\.\/integrations\//g, "from '../integrations/"])
  } else if (isIntegrationsTwitch) {
    // Inside integrations/twitch/: ../../ → ../../core/ or ../../infra/
    replacements.push([/from ['"]\.\.\/\.\.\/types\.js['"]/g, "from '../../core/types.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/config\.js['"]/g, "from '../../core/config.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/activity\.js['"]/g, "from '../../core/activity.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/blocklist\.js['"]/g, "from '../../core/blocklist.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/fallback\.js['"]/g, "from '../../core/fallback.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/finish\.js['"]/g, "from '../../core/finish.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/i18n\.js['"]/g, "from '../../core/i18n.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/player\.js['"]/g, "from '../../core/player.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/playlists\.js['"]/g, "from '../../core/playlists.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/queue\.js['"]/g, "from '../../core/queue.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/settings\.js['"]/g, "from '../../core/settings.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/state-file\.js['"]/g, "from '../../core/state-file.js'"])

    replacements.push([/from ['"]\.\.\/\.\.\/config-helper\.js['"]/g, "from '../../infra/config-helper.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/logger\.js['"]/g, "from '../../infra/logger.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/persist\.js['"]/g, "from '../../infra/persist.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/port\.js['"]/g, "from '../../infra/port.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/runtime\.js['"]/g, "from '../../infra/runtime.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/secrets\.js['"]/g, "from '../../infra/secrets.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/server-config\.js['"]/g, "from '../../infra/server-config.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/shutdown\.js['"]/g, "from '../../infra/shutdown.js'"])
    replacements.push([/from ['"]\.\.\/\.\.\/state-events\.js['"]/g, "from '../../infra/state-events.js'"])
  } else if (isIntegrationsYoutube) {
    // Inside integrations/youtube/: ../ → ../../core/ or ../../infra/
    replacements.push([/from ['"]\.\.\/types\.js['"]/g, "from '../../core/types.js'"])
    replacements.push([/from ['"]\.\.\/config\.js['"]/g, "from '../../core/config.js'"])
    replacements.push([/from ['"]\.\.\/activity\.js['"]/g, "from '../../core/activity.js'"])
    replacements.push([/from ['"]\.\.\/blocklist\.js['"]/g, "from '../../core/blocklist.js'"])
    replacements.push([/from ['"]\.\.\/fallback\.js['"]/g, "from '../../core/fallback.js'"])
    replacements.push([/from ['"]\.\.\/finish\.js['"]/g, "from '../../core/finish.js'"])
    replacements.push([/from ['"]\.\.\/i18n\.js['"]/g, "from '../../core/i18n.js'"])
    replacements.push([/from ['"]\.\.\/player\.js['"]/g, "from '../../core/player.js'"])
    replacements.push([/from ['"]\.\.\/playlists\.js['"]/g, "from '../../core/playlists.js'"])
    replacements.push([/from ['"]\.\.\/queue\.js['"]/g, "from '../../core/queue.js'"])
    replacements.push([/from ['"]\.\.\/settings\.js['"]/g, "from '../../core/settings.js'"])
    replacements.push([/from ['"]\.\.\/state-file\.js['"]/g, "from '../../core/state-file.js'"])

    replacements.push([/from ['"]\.\.\/config-helper\.js['"]/g, "from '../../infra/config-helper.js'"])
    replacements.push([/from ['"]\.\.\/logger\.js['"]/g, "from '../../infra/logger.js'"])
    replacements.push([/from ['"]\.\.\/persist\.js['"]/g, "from '../../infra/persist.js'"])
    replacements.push([/from ['"]\.\.\/port\.js['"]/g, "from '../../infra/port.js'"])
    replacements.push([/from ['"]\.\.\/runtime\.js['"]/g, "from '../../infra/runtime.js'"])
    replacements.push([/from ['"]\.\.\/secrets\.js['"]/g, "from '../../infra/secrets.js'"])
    replacements.push([/from ['"]\.\.\/server-config\.js['"]/g, "from '../../infra/server-config.js'"])
    replacements.push([/from ['"]\.\.\/shutdown\.js['"]/g, "from '../../infra/shutdown.js'"])
    replacements.push([/from ['"]\.\.\/state-events\.js['"]/g, "from '../../infra/state-events.js'"])
  }

  for (const [pattern, replacement] of replacements) {
    if (newContent.match(pattern)) {
      newContent = newContent.replace(pattern, replacement)
      modified = true
    }
  }

  if (modified) {
    writeFileSync(filePath, newContent, 'utf-8')
    console.log(`Fixed: ${relPath}`)
  }

  return modified
}

// Process all .ts files in src/
const srcFiles = getTsFiles(join(projectRoot, 'src'))

let count = 0
for (const file of srcFiles) {
  if (fixImports(file)) {
    count++
  }
}

console.log(`\nFixed ${count} files`)
