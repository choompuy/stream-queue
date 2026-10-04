import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { copyFileSync, chmodSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import { inject } from 'postject'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const ICON = path.join('tray', 'icon.ico')
const RCEDIT_TIMEOUT_MS = 60_000

const OUT_DIR = 'dist-sea'
const BUNDLE = path.join(OUT_DIR, 'bundle.cjs')
const BLOB = path.join(OUT_DIR, 'sea-prep.blob')
const EXE_NAME = process.platform === 'win32' ? 'Service.exe' : 'Service'
const EXE_PATH = path.join(OUT_DIR, EXE_NAME)
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
const BAKED = Object.fromEntries(['TWITCH_CLIENT_ID'].map((key) => [key, process.env[key]?.trim() ?? '']))

if (!BAKED.TWITCH_CLIENT_ID) {
  console.warn('! TWITCH_CLIENT_ID is not set: this build starts with the Twitch integration off (put it in .env or the environment)')
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

console.log('> esbuild bundle')
await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: BUNDLE,
  define: { __BAKED_ENV__: JSON.stringify(BAKED) }
})

console.log('> node --experimental-sea-config')
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { stdio: 'inherit' })

copyFileSync(process.execPath, EXE_PATH)
if (process.platform !== 'win32') chmodSync(EXE_PATH, 0o755)

if (process.platform === 'darwin') {
  execFileSync('codesign', ['--remove-signature', EXE_PATH], { stdio: 'inherit' })
}

// The icon and version shown in Explorer and Task Manager (Windows only).
// This has to happen on the plain node.exe copy: rcedit rewrites the file's resources, and run on the finished exe it
// hangs or damages the injected blob. A failure here is not fatal, the exe just keeps Node's own icon.
if (process.platform === 'win32') {
  try {
    const { default: rcedit } = await import('rcedit')
    const edit = rcedit(EXE_PATH, {
      icon: existsSync(ICON) ? ICON : undefined,
      'product-version': pkg.version,
      'file-version': pkg.version,
      'version-string': {
        ProductName: 'Stream Queue',
        FileDescription: 'Stream Queue song request server',
        OriginalFilename: EXE_NAME,
        CompanyName: pkg.author ?? ''
      }
    })
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`rcedit did not finish in ${RCEDIT_TIMEOUT_MS / 1000}s`)), RCEDIT_TIMEOUT_MS)
    })
    await Promise.race([edit, timeout]).finally(() => clearTimeout(timer))
    console.log('> icon and version set')
  } catch (error) {
    console.warn(`! could not set the icon and version: ${error instanceof Error ? error.message : error}`)
  }
}

console.log('> postject inject')
await inject(EXE_PATH, 'NODE_SEA_BLOB', readFileSync(BLOB), {
  sentinelFuse: SENTINEL_FUSE,
  machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined
})

if (process.platform === 'darwin') {
  execFileSync('codesign', ['--sign', '-', EXE_PATH], { stdio: 'inherit' })
}

console.log(`\nBuilt ${EXE_PATH}`)
console.log('For a folder that is ready to run (exe + public/ + license) use `npm run build:release`.')
