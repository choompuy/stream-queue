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
    private const long MaxLogBytes = 5 * 1024 * 1024; // rotate past 5MB so this never grows unbounded

    private readonly string _exePath;
    private readonly string _logPath;
    private readonly object _logLock = new();

    private Process? _process;
    private bool _stoppingIntentionally;

    public int? Port { get; private set; }
    public event Action<int>? PortDiscovered;
    public event Action<int>? Crashed; // exit code

    public ServerManager()
    {
        _exePath = Path.Combine(AppContext.BaseDirectory, "Service.exe");

        var logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "StreamQueue", "logs");
        Directory.CreateDirectory(logDir);
        _logPath = Path.Combine(logDir, "tray.log");
    }

    public string LogDirectory => Path.GetDirectoryName(_logPath)!;
    public string LogPath => _logPath;

    public void Start()
    {
        if (!File.Exists(_exePath))
        {
            throw new ServerStartException(
                $"Service.exe was not found next to the launcher:\n{_exePath}\n\n" +
                "Make sure Service.exe and the public/ folder sit in the same directory as this app.");
        }

        Port = null;
        _stoppingIntentionally = false;

        var info = new ProcessStartInfo
        {
            FileName = _exePath,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        info.Environment["STREAMQUEUE_NO_AUTO_OPEN"] = "1";

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => HandleLine(e.Data);
        process.ErrorDataReceived += (_, e) => HandleLine(e.Data);
        process.Exited += (_, _) => HandleExit(process);

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        _process = process;

        WriteLog("--- StreamQueue starting ---");
    }

    private void HandleLine(string? line)
    {
        if (line is null) return;
        WriteLog(line);

        if (Port is null)
        {
            var match = PortRegex.Match(line);
            if (match.Success && int.TryParse(match.Groups[1].Value, out var port))
            {
                Port = port;
                PortDiscovered?.Invoke(port);
            }
        }
    }

    private void HandleExit(Process process)
    {
        var exitCode = SafeExitCode(process);
        WriteLog($"--- StreamQueue exited (code {exitCode}) ---");

        if (!_stoppingIntentionally)
        {
            Crashed?.Invoke(exitCode);
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

    public async Task StopAsync()
    {
        var process = _process;
        if (process is null || process.HasExited) return;

        _stoppingIntentionally = true;

        var stoppedGracefully = false;
        if (Port is { } port)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                await client.PostAsync($"http://localhost:{port}/api/shutdown", null);
                stoppedGracefully = await WaitForExitAsync(process, TimeSpan.FromSeconds(3));
            }
            catch
            {
                // server unreachable/unresponsive - fall through to Kill()
            }
        }

        if (!stoppedGracefully && !process.HasExited)
        {
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch
            {
                // already gone
            }
        }

        await WaitForExitAsync(process, TimeSpan.FromSeconds(5));
    }

    private static async Task<bool> WaitForExitAsync(Process process, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
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
                // logging is best-effort - never let it take the app down
            }
        }
    }

    public void Dispose()
    {
        _process?.Dispose();
    }
}
