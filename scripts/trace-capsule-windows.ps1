param(
    [ValidateRange(1, 600)][int]$DurationSeconds = 120,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
# Read-only diagnostic: no input injection, window changes, titles, text or images.
$targets = @(Get-Process runbi-desktop, Doubao -ErrorAction SilentlyContinue)
if (-not ($targets | Where-Object ProcessName -eq 'runbi-desktop')) {
    throw 'Runbi is not running; start the test build first.'
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
public static class RunbiWindowTrace {
    delegate bool Callback(IntPtr hwnd, IntPtr unused);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr unused);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    struct Rect { public int Left, Top, Right, Bottom; }
    public static void Run(int[] pids, string[] names, int seconds, string output) {
        var owners = new Dictionary<uint,string>();
        for (int i=0; i<pids.Length; i++) owners[(uint)pids[i]] = names[i];
        using (var writer = new StreamWriter(output, false)) {
            writer.AutoFlush = true;
            writer.WriteLine("started_utc=" + DateTime.UtcNow.ToString("o") + " sample_ms=20 duration_s=" + seconds);
            var clock = Stopwatch.StartNew();
            var previous = "";
            while (clock.Elapsed.TotalSeconds < seconds) {
                var windows = new List<string>();
                EnumWindows((hwnd, unused) => {
                    uint pid; GetWindowThreadProcessId(hwnd, out pid);
                    string name; Rect rect;
                    if (owners.TryGetValue(pid, out name) && IsWindowVisible(hwnd) && GetWindowRect(hwnd, out rect)) {
                        int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
                        // Ignore tray/helper and minimized off-screen windows, retain all real target surfaces.
                        if (width >= 30 && height >= 20 && rect.Left > -30000 && rect.Top > -30000)
                            windows.Add(name + ":" + pid + ":" + hwnd.ToInt64() + ":" + rect.Left + "," + rect.Top + "," + width + "," + height);
                    }
                    return true;
                }, IntPtr.Zero);
                windows.Sort(StringComparer.Ordinal);
                var state = "left=" + ((GetAsyncKeyState(1) & 0x8000) != 0)
                    + " right=" + ((GetAsyncKeyState(2) & 0x8000) != 0)
                    + " foreground_hwnd=" + GetForegroundWindow().ToInt64()
                    + " clipboard_seq=" + GetClipboardSequenceNumber()
                    + " windows=[" + String.Join(";", windows) + "]";
                if (state != previous) {
                    writer.WriteLine("elapsed_ms=" + clock.ElapsedMilliseconds + " " + state);
                    previous = state;
                }
                Thread.Sleep(20);
            }
            writer.WriteLine("finished_utc=" + DateTime.UtcNow.ToString("o"));
        }
    }
}
'@
[RunbiWindowTrace]::Run([int[]]@($targets.Id), [string[]]@($targets.ProcessName), $DurationSeconds, $OutputPath)
# Small runnable check: successful completion must have an initial sample and end marker.
$trace = @(Get-Content -LiteralPath $OutputPath)
if ($trace.Count -lt 3 -or $trace[-1] -notlike 'finished_utc=*') {
    throw 'Incomplete diagnostic trace.'
}
Write-Output "Trace complete: $OutputPath"
