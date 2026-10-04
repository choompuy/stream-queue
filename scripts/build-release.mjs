// Builds the folder a streamer can run: Service.exe + public/ + license, and on Windows the tray launcher (StreamQueue.exe) too.
// `npm run build:release`
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const EXE_NAME = process.platform === 'win32' ? 'Service.exe' : 'Service'
const BUILT_EXE = path.join('dist-sea', EXE_NAME)
const RELEASE_DIR = 'release'

console.log(`> building ${pkg.name}-v${pkg.version}`)
execFileSync(process.execPath, ['scripts/build-sea.mjs'], { stdio: 'inherit' })

rmSync(RELEASE_DIR, { recursive: true, force: true })
mkdirSync(RELEASE_DIR, { recursive: true })

cpSync(BUILT_EXE, path.join(RELEASE_DIR, EXE_NAME))
cpSync('public', path.join(RELEASE_DIR, 'public'), { recursive: true })
cpSync('LICENSE', path.join(RELEASE_DIR, 'LICENSE'))
writeFileSync(path.join(RELEASE_DIR, 'VERSION.txt'), `${pkg.name}-v${pkg.version}\n`)

// The tray launcher (tray/, C# WinForms) is what a streamer double-clicks: it starts Service.exe hidden and gives it a tray icon.
// It needs the .NET SDK, so it is built only on Windows and only if `dotnet` is there; without it the release still works,
// Service.exe just has to be started by hand
function hasDotnet() {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (process.platform === 'win32') {
  if (hasDotnet()) {
    console.log('> tray launcher (dotnet publish)')
    const trayOut = path.join('dist-sea', 'tray')
    execFileSync(
      'dotnet',
      [
        'publish',
        'tray',
        '-c',
        'Release',
        '-r',
        'win-x64',
        '--self-contained',
        'true',
        '-p:PublishSingleFile=true',
        '-p:IncludeNativeLibrariesForSelfExtract=true',
        '-o',
        trayOut
      ],
      { stdio: 'inherit' }
    )
    // the tray reads icon.ico from disk next to itself
    cpSync(path.join(trayOut, 'StreamQueue.exe'), path.join(RELEASE_DIR, 'StreamQueue.exe'))
    cpSync(path.join(trayOut, 'icon.ico'), path.join(RELEASE_DIR, 'icon.ico'))
  } else {
    console.warn('! the .NET SDK (dotnet) was not found: the release has no tray launcher (StreamQueue.exe), start Service.exe by hand')
  }
}

console.log(`\nRelease folder ready: ${RELEASE_DIR}/ (data/ and cache/ are created next to the exe on first run)`)
console.log('Not code-signed: Windows SmartScreen will warn on first launch until the exe is signed.')
