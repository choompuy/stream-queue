# Service Tray

Small WinForms tray launcher: starts `Service.exe` (the SEA-built server) as a
hidden background process, shows a tray icon with Open panel / Open logs folder /
Restart server / Exit.

## Heads up: not compile-tested

Everything else in this repo (the Node/TS backend, the SEA build) I actually ran
and verified end-to-end. This C# project I could not - the sandbox this was
written in has no route to `api.nuget.org` (network policy only allows npm/PyPI/
GitHub), so `dotnet restore` can't fetch the WinForms reference assemblies and
`dotnet build` fails before it even gets to compiling. The code follows
standard, well-established WinForms/NotifyIcon/Process patterns, but you should
build it yourself before trusting it - see below.

## Build (dev/testing)

Requires the .NET 8 SDK on Windows.

```
cd tray
dotnet build
```

Produces a framework-dependent exe under `bin/Debug/net8.0-windows/` (needs the
.NET 8 Desktop Runtime installed - if you have the SDK you already have it).

## Publish (distributable single exe)

```
cd tray
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

These flags (self-contained, target runtime, single-file) are deliberately passed
here and not baked into the .csproj - having them in the project file makes even
a plain `dotnet build` try to resolve self-contained runtime packs it doesn't
need, which is exactly what broke the first build attempt.

Output: `bin/Release/net8.0-windows/win-x64/publish/StreamQueue.exe` - one
file, self-contained (bundles its own .NET runtime, ~60-70MB), no separate
runtime install needed on the machine you hand it to.

## Assembling the final folder

The launcher expects `Service.exe` (built via `npm run build:sea` in the repo
root) sitting right next to it, plus the `public/` folder next to that:

```
Service/
  StreamQueue.exe   <- from dotnet publish above
  Service.exe       <- from npm run build:sea (dist-sea/Service.exe)
  public/               <- copy from the repo root
```

`data/` and `cache/` are created **next to `Service.exe`** (see `src/persist.ts`),
so this whole folder is self-contained and portable - copy it as-is to move the
whole setup, but that also means it carries your queue/settings/blocklist along
if you zip and hand it to someone else.

## What to actually test on Windows

- Double-click `StreamQueue.exe` - tray icon should appear, no console window,
  no browser tab popping open on its own (that's intentional - suppressed via
  `STREAMQUEUE_NO_AUTO_OPEN`, see `ServerManager.Start()`).
- Tray menu "Open panel" - should open the control panel in your default browser.
- "Open logs folder" - opens the `logs/` folder next to `StreamQueue.exe`, should
  contain `tray.log` with the server's stdout/stderr, timestamped.
- "Restart server" - stops and starts the child process; check the tray tooltip
  updates with the new port once it's back up.
- "Exit" - tray icon disappears immediately, `Service.exe` process should be
  gone from Task Manager within a couple seconds (graceful `/api/shutdown` first,
  falls back to a hard kill if the server doesn't respond in 3s - see
  `ServerManager.StopAsync`).
- Launch a second `StreamQueue.exe` while the first is running - should show
  "already running" and not spawn a second server.
- Kill `Service.exe` directly in Task Manager while the tray is running -
  tray should show a balloon notification ("stopped unexpectedly") rather than
  silently doing nothing.

## Icon

`icon.ico` is included in this folder and wired up in `StreamQueueTray.csproj`
two ways: `<ApplicationIcon>` embeds it into the exe itself (what you see in
Explorer/Alt-Tab), and a `<None Update="icon.ico">` item with
`CopyToOutputDirectory`/`CopyToPublishDirectory` makes both `dotnet build` and
`dotnet publish` copy the actual file next to the exe - `TrayContext.LoadIcon()`
reads it from disk at runtime for the tray icon itself, since `NotifyIcon`
doesn't have access to the embedded resource. `ExcludeFromSingleFile` keeps it
as a loose file rather than baked into the single-file bundle, which is what
`LoadIcon()` needs. If you swap in a different `icon.ico`, both of those still
apply automatically - no csproj changes needed.
