import { execFileSync } from 'node:child_process'
import { copyFileSync, chmodSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import { inject } from 'postject'

const OUT_DIR = 'dist-sea'
const BUNDLE = path.join(OUT_DIR, 'bundle.cjs')
const BLOB = path.join(OUT_DIR, 'sea-prep.blob')
const EXE_NAME = process.platform === 'win32' ? 'Service.exe' : 'Service'
const EXE_PATH = path.join(OUT_DIR, EXE_NAME)
const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

console.log('> esbuild bundle')
await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: BUNDLE
})

console.log('> node --experimental-sea-config')
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { stdio: 'inherit' })

copyFileSync(process.execPath, EXE_PATH)
if (process.platform !== 'win32') chmodSync(EXE_PATH, 0o755)

if (process.platform === 'darwin') {
  execFileSync('codesign', ['--remove-signature', EXE_PATH], { stdio: 'inherit' })
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
console.log('Copy the public/ folder next to it before running (data/ and cache/ are created automatically).')
