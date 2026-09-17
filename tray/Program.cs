using System;
using System.Threading;
using System.Windows.Forms;

namespace StreamQueueTray;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.ThreadException += (_, e) =>
            MessageBox.Show($"Unexpected error:\n\n{e.Exception}", "StreamQueue", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            MessageBox.Show($"Unexpected error:\n\n{e.ExceptionObject}", "StreamQueue", MessageBoxButtons.OK, MessageBoxIcon.Error);

        using var mutex = new Mutex(true, "Global\\StreamQueue", out var isNew);
        if (!isNew)
        {
            MessageBox.Show("StreamQueue is already running - check the system tray.", "StreamQueue",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayContext());
    }
}
