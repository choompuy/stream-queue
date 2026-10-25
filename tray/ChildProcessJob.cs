using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace StreamQueueTray;

/// <summary>
/// A Windows job object that ends every process in it when the last handle to it closes, and the only handle is ours.
/// When the tray dies without running its exit code (Task Manager "End task", a crash), Windows closes the handle and
/// takes the server with it; otherwise the server would be left running with nobody to stop it.
/// </summary>
internal static class ChildProcessJob
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint KillOnJobClose = 0x2000;

    private static readonly IntPtr Job = Create();

    /// <summary>Returns null when the process is tied to the tray, else why it was not.</summary>
    public static string? Add(Process process)
    {
        if (Job == IntPtr.Zero) return "the job object could not be created";
        if (AssignProcessToJobObject(Job, process.Handle)) return null;

        return $"the server could not be assigned to the job object: {new Win32Exception(Marshal.GetLastWin32Error()).Message}";
    }

    private static IntPtr Create()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;

        var limits = new ExtendedLimitInformation { BasicLimits = { LimitFlags = KillOnJobClose } };
        var size = Marshal.SizeOf<ExtendedLimitInformation>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size)) return job;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }

        CloseHandle(job);
        return IntPtr.Zero;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimits;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr information, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
