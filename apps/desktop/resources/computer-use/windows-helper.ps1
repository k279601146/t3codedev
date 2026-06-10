$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class T3ComputerNative {
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] private static extern short VkKeyScan(char ch);

  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] private struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  private const int SM_XVIRTUALSCREEN = 76;
  private const int SM_YVIRTUALSCREEN = 77;
  private const int SM_CXVIRTUALSCREEN = 78;
  private const int SM_CYVIRTUALSCREEN = 79;
  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  private const uint MOUSEEVENTF_WHEEL = 0x0800;
  private const uint MOUSEEVENTF_HWHEEL = 0x01000;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;

  private static Dictionary<string, object> Rect(int x, int y, int width, int height) {
    return new Dictionary<string, object> { { "x", x }, { "y", y }, { "width", width }, { "height", height } };
  }

  private static Dictionary<string, object> Point(int x, int y) {
    return new Dictionary<string, object> { { "x", x }, { "y", y } };
  }

  public static Dictionary<string, object> State() {
    POINT point;
    GetCursorPos(out point);
    IntPtr hwnd = GetForegroundWindow();
    string title = "";
    int processId = 0;
    string processName = null;
    if (hwnd != IntPtr.Zero) {
      var sb = new StringBuilder(512);
      GetWindowText(hwnd, sb, sb.Capacity);
      title = sb.ToString();
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      processId = (int)pid;
      try {
        processName = Process.GetProcessById(processId).ProcessName;
      } catch {
        processName = null;
      }
    }

    return new Dictionary<string, object> {
      { "virtualScreen", Rect(GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN)) },
      { "cursor", Point(point.X, point.Y) },
      { "foregroundWindow", new Dictionary<string, object> { { "title", title }, { "processId", processId == 0 ? (object)null : processId }, { "processName", processName } } }
    };
  }

  public static Dictionary<string, object> Screenshot(string path) {
    int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        graphics.CopyFromScreen(x, y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
      }
      bitmap.Save(path, ImageFormat.Png);
    }
    var result = State();
    result["screenshot"] = new Dictionary<string, object> {
      { "path", path },
      { "originX", x },
      { "originY", y },
      { "width", width },
      { "height", height },
      { "scaleFactor", 1 }
    };
    return result;
  }

  private static void SendMouse(uint flags, uint data) {
    var input = new INPUT();
    input.type = INPUT_MOUSE;
    input.U.mi = new MOUSEINPUT { dx = 0, dy = 0, mouseData = data, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero };
    SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }

  private static Tuple<uint,uint> ButtonFlags(string button) {
    switch ((button ?? "left").ToLowerInvariant()) {
      case "right": return Tuple.Create(MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP);
      case "middle": return Tuple.Create(MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP);
      default: return Tuple.Create(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP);
    }
  }

  public static Dictionary<string, object> MoveMouse(int x, int y) {
    SetCursorPos(x, y);
    return State();
  }

  public static Dictionary<string, object> Click(int x, int y, string button, int count) {
    SetCursorPos(x, y);
    var flags = ButtonFlags(button);
    for (int i = 0; i < count; i++) {
      SendMouse(flags.Item1, 0);
      Thread.Sleep(30);
      SendMouse(flags.Item2, 0);
      Thread.Sleep(80);
    }
    return State();
  }

  public static Dictionary<string, object> Drag(int fromX, int fromY, int toX, int toY, int durationMs) {
    int steps = Math.Max(8, Math.Min(80, durationMs / 12));
    int delay = Math.Max(1, durationMs / steps);
    SetCursorPos(fromX, fromY);
    SendMouse(MOUSEEVENTF_LEFTDOWN, 0);
    for (int i = 1; i <= steps; i++) {
      int x = fromX + (toX - fromX) * i / steps;
      int y = fromY + (toY - fromY) * i / steps;
      SetCursorPos(x, y);
      Thread.Sleep(delay);
    }
    SendMouse(MOUSEEVENTF_LEFTUP, 0);
    return State();
  }

  public static Dictionary<string, object> Scroll(int x, int y, int deltaX, int deltaY) {
    SetCursorPos(x, y);
    if (deltaY != 0) SendMouse(MOUSEEVENTF_WHEEL, unchecked((uint)deltaY));
    if (deltaX != 0) SendMouse(MOUSEEVENTF_HWHEEL, unchecked((uint)deltaX));
    return State();
  }

  private static void SendKey(ushort vk, ushort scan, uint flags) {
    var input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.U.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero };
    SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void SendUnicodeText(string text) {
    foreach (char ch in text ?? "") {
      SendKey(0, ch, KEYEVENTF_UNICODE);
      SendKey(0, ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
    }
  }

  private static ushort KeyToVk(string key) {
    string normalized = (key ?? "").Trim();
    if (normalized.Length == 0) throw new Exception("Key is required.");
    switch (normalized.ToLowerInvariant()) {
      case "ctrl":
      case "control": return (ushort)Keys.ControlKey;
      case "shift": return (ushort)Keys.ShiftKey;
      case "alt":
      case "option": return (ushort)Keys.Menu;
      case "win":
      case "meta":
      case "cmd":
      case "command": return (ushort)Keys.LWin;
      case "enter":
      case "return": return (ushort)Keys.Return;
      case "esc":
      case "escape": return (ushort)Keys.Escape;
      case "backspace": return (ushort)Keys.Back;
      case "delete":
      case "del": return (ushort)Keys.Delete;
      case "tab": return (ushort)Keys.Tab;
      case "space": return (ushort)Keys.Space;
      case "up":
      case "arrowup": return (ushort)Keys.Up;
      case "down":
      case "arrowdown": return (ushort)Keys.Down;
      case "left":
      case "arrowleft": return (ushort)Keys.Left;
      case "right":
      case "arrowright": return (ushort)Keys.Right;
      case "pageup": return (ushort)Keys.PageUp;
      case "pagedown": return (ushort)Keys.PageDown;
    }
    Keys parsed;
    if (Enum.TryParse<Keys>(normalized, true, out parsed)) return (ushort)parsed;
    if (normalized.Length == 1) {
      short scan = VkKeyScan(normalized[0]);
      if (scan != -1) return (ushort)(scan & 0xff);
    }
    throw new Exception("Unsupported key: " + key);
  }

  public static Dictionary<string, object> Press(string key) {
    if ((key ?? "").Length == 1) {
      SendUnicodeText(key);
    } else {
      ushort vk = KeyToVk(key);
      SendKey(vk, 0, 0);
      SendKey(vk, 0, KEYEVENTF_KEYUP);
    }
    return State();
  }

  public static Dictionary<string, object> Hotkey(string[] keys) {
    if (keys == null || keys.Length == 0) throw new Exception("keys is required.");
    var vks = new List<ushort>();
    foreach (var key in keys) vks.Add(KeyToVk(key));
    for (int i = 0; i < vks.Count; i++) SendKey(vks[i], 0, 0);
    for (int i = vks.Count - 1; i >= 0; i--) SendKey(vks[i], 0, KEYEVENTF_KEYUP);
    return State();
  }
}
"@

function Write-Json($value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 32))
  [Console]::Out.Flush()
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $args = $request.arguments
    switch ($request.command) {
      "state" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::State() }
      }
      "screenshot" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Screenshot([string]$args.path) }
      }
      "moveMouse" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::MoveMouse([int]$args.x, [int]$args.y) }
      }
      "click" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Click([int]$args.x, [int]$args.y, [string]$args.button, [int]$args.count) }
      }
      "drag" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Drag([int]$args.fromX, [int]$args.fromY, [int]$args.toX, [int]$args.toY, [int]$args.durationMs) }
      }
      "scroll" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Scroll([int]$args.x, [int]$args.y, [int]$args.deltaX, [int]$args.deltaY) }
      }
      "type" {
        [T3ComputerNative]::SendUnicodeText([string]$args.text)
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::State() }
      }
      "press" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Press([string]$args.key) }
      }
      "hotkey" {
        $keys = @($args.keys | ForEach-Object { [string]$_ })
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Hotkey([string[]]$keys) }
      }
      default {
        Write-Json @{ id = $request.id; ok = $false; error = "Unsupported command: $($request.command)" }
      }
    }
  } catch {
    $id = if ($null -ne $request) { $request.id } else { $null }
    Write-Json @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
}
