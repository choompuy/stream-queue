using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace StreamQueueTray;

internal sealed class ServerStartException : Exception
{
    public ServerStartException(string message) : base(message) { }
}

internal sealed class ServerManager : IDisposable
{
    private static readonly Regex PortRegex = new(@"Server running on http://localhost:(\d+)", RegexOptions.Compiled);
    private const long MaxLogBytes = 5 * 1024 * 1024;

    private sealed class ProcessState
    {
        public Process Process { get; }
        public bool StoppingIntentionally { get; set; }

        public ProcessState(Process process)
        {
            Process = process;
        }
    }

    private readonly string _exePath;
    private readonly string _logPath;
    private readonly object _logLock = new();
    private readonly SemaphoreSlim _lifecycleLock = new(1, 1);
    private ProcessState? _processState;
    private bool _disposed;
    public int? Port { get; private set; }
    public event Action<int>? PortDiscovered;
    public event Action<int>? Crashed;

    public ServerManager()
    {
        _exePath = Path.Combine(AppContext.BaseDirectory, "Service.exe");
        var logDir = Path.Combine(AppContext.BaseDirectory, "logs");
        Directory.CreateDirectory(logDir);
        _logPath = Path.Combine(logDir, "tray.log");
    }

    public void Start()
    {
        _lifecycleLock.Wait();

        try
        {
            ThrowIfDisposed();
            if (IsProcessRunning(_processState)) return;
            StartCore();
        }
        finally
        {
            _lifecycleLock.Release();
        }
    }

    public async Task StopAsync()
    {
        await _lifecycleLock.WaitAsync().ConfigureAwait(false);

        try
        {
            if (_disposed) return;
            await StopCoreAsync().ConfigureAwait(false);
        }
        finally
        {
            _lifecycleLock.Release();
        }
    }

    private void StartCore()
    {
        if (!File.Exists(_exePath))
        {
            throw new ServerStartException(
                $"Service.exe was not found next to the launcher:\n{_exePath}\n\n" +
                "Make sure Service.exe and the public/ folder sit in the same directory as this app.");
        }

        Port = null;

        var startInfo = new ProcessStartInfo
        {
            FileName = _exePath,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        var process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        var state = new ProcessState(process);

        process.OutputDataReceived += (_, e) => HandleLine(e.Data);
        process.ErrorDataReceived += (_, e) => HandleLine(e.Data);
        process.Exited += (_, _) => HandleExit(state);

        try
        {
            process.Start();
            _processState = state;
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            WriteLog("--- StreamQueue starting ---");
        }
        catch
        {
            process.Dispose();
            throw;
        }
    }

    private async Task StopCoreAsync()
    {
        var state = _processState;
        if (state is null) return;

        var process = state.Process;
        if (IsProcessExited(process))
        {
            CleanupProcessState(state);
            return;
        }

        state.StoppingIntentionally = true;
        var stoppedGracefully = false;

        if (Port is { } port)
        {
            try
            {
                using var client = new HttpClient
                {
                    Timeout = TimeSpan.FromSeconds(3)
                };

                await client.PostAsync($"http://localhost:{port}/api/shutdown", null).ConfigureAwait(false);

                stoppedGracefully = await WaitForExitAsync(process, TimeSpan.FromSeconds(3)).ConfigureAwait(false);
            }
            catch
            {
                // Server unreachable/unresponsive.
                // Fall through to Kill().
            }
        }

        if (!stoppedGracefully)
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }
            }
            catch (InvalidOperationException)
            {
                // Process already exited, is no longer associated, or was disposed.
            }
        }

        await WaitForExitAsync(process, TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        CleanupProcessState(state);
    }

    private void HandleExit(ProcessState state)
    {
        var process = state.Process;
        var exitCode = SafeExitCode(process);
        var stoppedIntentionally = state.StoppingIntentionally;

        WriteLog($"--- StreamQueue exited (code {exitCode}) ---");

        if (ReferenceEquals(_processState, state))
        {
            _processState = null;
            Port = null;
        }

        if (!stoppedIntentionally)
        {
            try
            {
                Crashed?.Invoke(exitCode);
            }
            catch
            {
                // Event handlers must never break process cleanup.
            }
        }

        process.Dispose();
    }

    private void HandleLine(string? line)
    {
        if (line is null) return;
        WriteLog(line);

        if (Port is not null) return;

        var match = PortRegex.Match(line);

        if (!match.Success) return;
        if (!int.TryParse(match.Groups[1].Value, out var port))
        {
            return;
        }

        Port = port;
        PortDiscovered?.Invoke(port);
    }

    private void CleanupProcessState(ProcessState state)
    {
        if (!ReferenceEquals(_processState, state)) return;
        _processState = null;
        Port = null;

        try
        {
            state.Process.Dispose();
        }
        catch
        {
            // Process cleanup is best-effort.
        }
    }

    private static bool IsProcessRunning(ProcessState? state)
    {
        if (state is null) return false;
        return !IsProcessExited(state.Process);
    }

    private static bool IsProcessExited(Process process)
    {
        try
        {
            return process.HasExited;
        }
        catch (InvalidOperationException)
        {
            return true;
        }
    }

    private static int SafeExitCode(Process process)
    {
        try
        {
            return process.ExitCode;
        }
        catch
        {
            return -1;
        }
    }

    private static async Task<bool> WaitForExitAsync(Process process, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);

        try
        {
            await process.WaitForExitAsync(cts.Token).ConfigureAwait(false);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return true;
        }
    }

    private void WriteLog(string line)
    {
        lock (_logLock)
        {
            try
            {
                if (File.Exists(_logPath) && new FileInfo(_logPath).Length > MaxLogBytes)
                {
                    File.Copy(_logPath, _logPath + ".old", overwrite: true);
                    File.Delete(_logPath);
                }

                File.AppendAllText(_logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {line}{Environment.NewLine}");
            }
            catch
            {
                // Logging is best-effort - never let the app take down the tray.
            }
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(ServerManager));
    }

    public void Dispose()
    {
        if (_disposed) return;

        _lifecycleLock.Wait();

        try
        {
            if (_disposed) return;

            _disposed = true;
            var state = _processState;
            _processState = null;
            Port = null;

            try
            {
                state?.Process.Dispose();
            }
            catch
            {
                // Cleanup is best-effort.
            }
        }
        finally
        {
            _lifecycleLock.Release();
            _lifecycleLock.Dispose();
        }

        GC.SuppressFinalize(this);
    }
}