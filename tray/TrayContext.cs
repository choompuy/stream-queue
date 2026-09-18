using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace StreamQueueTray;

internal sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon _trayIcon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ServerManager _server;
    private readonly Control _uiThread;
    private bool _exiting;

    public TrayContext()
    {
        _uiThread = new Control();
        _ = _uiThread.Handle;

        _server = new ServerManager();
        _server.PortDiscovered += port => RunOnUiThread(() => OnPortDiscovered(port));
        _server.Crashed += exitCode => RunOnUiThread(() => OnServerCrashed(exitCode));

        var menu = new ContextMenuStrip();

        _statusItem = new ToolStripMenuItem("Starting...") { Enabled = false };
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open panel", null, (_, _) => OpenPanel());
        menu.Items.Add("Open logs folder", null, (_, _) => OpenLogsFolder());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Restart server", null, async (_, _) => await RestartServerAsync());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, async (_, _) => await ExitAsync());

        _trayIcon = new NotifyIcon
        {
            Icon = LoadIcon(),
            Text = "StreamQueue",
            Visible = true,
            ContextMenuStrip = menu
        };
        _trayIcon.DoubleClick += (_, _) => OpenPanel();

        try
        {
            _server.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"StreamQueue failed to start:\n\n{ex}", "StreamQueue", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Cleanup();
        }
    }

    private static Icon LoadIcon()
    {
        try
        {
            var path = System.IO.Path.Combine(AppContext.BaseDirectory, "icon.ico");
            if (System.IO.File.Exists(path)) return new Icon(path);
        }
        catch
        {
            // fall through to the system default
        }

        return SystemIcons.Application;
    }

    private void OnPortDiscovered(int port)
    {
        _statusItem.Text = $"Running - port {port}";
        _trayIcon.Text = $"StreamQueue - port {port}";
    }

    private void OnServerCrashed(int exitCode)
    {
        _statusItem.Text = "Stopped unexpectedly";
        _trayIcon.ShowBalloonTip(5000, "StreamQueue",
            $"The server stopped unexpectedly (code {exitCode}). Use \"Restart server\" from the tray menu, " +
            "or check the logs.", ToolTipIcon.Warning);
    }

    private void OpenPanel()
    {
        var port = _server.Port ?? 3000;
        OpenUrl($"http://localhost:{port}");
    }

    private void OpenLogsFolder()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = _server.LogDirectory,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Couldn't open the logs folder:\n{ex.Message}", "StreamQueue",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    private async System.Threading.Tasks.Task RestartServerAsync()
    {
        _statusItem.Text = "Restarting...";
        await _server.StopAsync();
        try
        {
            _server.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"StreamQueue failed to start:\n\n{ex}", "StreamQueue", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async System.Threading.Tasks.Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        _trayIcon.Visible = false;
        await _server.StopAsync();
        Cleanup();
    }

    private void Cleanup()
    {
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _server.Dispose();
        _uiThread.Dispose();
        ExitThread();
    }

    private void RunOnUiThread(Action action)
    {
        if (_uiThread.IsHandleCreated)
        {
            _uiThread.BeginInvoke(action);
        }
        else
        {
            action();
        }
    }
}
