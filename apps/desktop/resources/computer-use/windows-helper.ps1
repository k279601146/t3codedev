$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms,WindowsBase,UIAutomationClient,UIAutomationTypes -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Windows.Automation;

public static class T3ComputerNative {
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] private static extern short VkKeyScan(char ch);
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
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
  private const int SW_RESTORE = 9;
  private const uint PW_RENDERFULLCONTENT = 0x00000002;
  private const int MAX_ACCESSIBILITY_ELEMENTS = 700;
  private const int MAX_ACCESSIBILITY_DEPTH = 10;
  private static Dictionary<string, Dictionary<int, AutomationElement>> LastAccessibilityElementsByWindow = new Dictionary<string, Dictionary<int, AutomationElement>>();

  private static Dictionary<string, object> Rect(int x, int y, int width, int height) {
    return new Dictionary<string, object> { { "x", x }, { "y", y }, { "width", width }, { "height", height } };
  }

  private static Dictionary<string, object> Point(int x, int y) {
    return new Dictionary<string, object> { { "x", x }, { "y", y } };
  }

  private static Dictionary<string, object> RectFromAutomation(AutomationElement element, RECT windowRect) {
    var bounds = element.Current.BoundingRectangle;
    if (bounds.IsEmpty || Double.IsInfinity(bounds.X) || Double.IsInfinity(bounds.Y)) {
      return new Dictionary<string, object> {
        { "x", 0 },
        { "y", 0 },
        { "width", 0 },
        { "height", 0 },
        { "screenX", 0 },
        { "screenY", 0 }
      };
    }
    return new Dictionary<string, object> {
      { "x", (int)Math.Round(bounds.X - windowRect.Left) },
      { "y", (int)Math.Round(bounds.Y - windowRect.Top) },
      { "width", Math.Max(0, (int)Math.Round(bounds.Width)) },
      { "height", Math.Max(0, (int)Math.Round(bounds.Height)) },
      { "screenX", (int)Math.Round(bounds.X) },
      { "screenY", (int)Math.Round(bounds.Y) }
    };
  }

  private static string SafeString(Func<string> read) {
    try {
      return read() ?? "";
    } catch {
      return "";
    }
  }

  private static bool SafeBool(Func<bool> read, bool fallback) {
    try {
      return read();
    } catch {
      return fallback;
    }
  }

  private static string ControlTypeName(AutomationElement element) {
    try {
      string programmatic = element.Current.ControlType.ProgrammaticName ?? "";
      int dot = programmatic.LastIndexOf('.');
      return dot >= 0 ? programmatic.Substring(dot + 1) : programmatic;
    } catch {
      return "Control";
    }
  }

  private static string Quote(string value) {
    return "\"" + (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
  }

  private static string TrimForTree(string value, int maxLength) {
    string normalized = (value ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
    if (normalized.Length <= maxLength) return normalized;
    return normalized.Substring(0, maxLength - 1) + "...";
  }

  private static bool SameRuntimeId(AutomationElement left, AutomationElement right) {
    try {
      int[] leftId = left.GetRuntimeId();
      int[] rightId = right.GetRuntimeId();
      if (leftId == null || rightId == null || leftId.Length != rightId.Length) return false;
      for (int i = 0; i < leftId.Length; i++) {
        if (leftId[i] != rightId[i]) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private static bool IsDescendantOf(AutomationElement candidate, AutomationElement root) {
    if (candidate == null || root == null) return false;
    if (SameRuntimeId(candidate, root)) return true;
    try {
      AutomationElement current = candidate;
      var walker = TreeWalker.ControlViewWalker;
      for (int i = 0; i < 80 && current != null; i++) {
        if (SameRuntimeId(current, root)) return true;
        current = walker.GetParent(current);
      }
    } catch {
      return false;
    }
    return false;
  }

  private static string ValueText(AutomationElement element) {
    try {
      object pattern;
      if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
        return ((ValuePattern)pattern).Current.Value ?? "";
      }
      if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
        return ((TextPattern)pattern).DocumentRange.GetText(4000) ?? "";
      }
    } catch {
    }
    return "";
  }

  private static string SelectedText(AutomationElement element) {
    try {
      object pattern;
      if (!element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return "";
      var selections = ((TextPattern)pattern).GetSelection();
      if (selections == null || selections.Length == 0) return "";
      var parts = new List<string>();
      foreach (var range in selections) {
        string text = range.GetText(1000);
        if (!String.IsNullOrWhiteSpace(text)) parts.Add(text.Trim());
      }
      return String.Join("\n", parts.ToArray());
    } catch {
      return "";
    }
  }

  private static List<string> SupportedActions(AutomationElement element) {
    var actions = new List<string>();
    try {
      object pattern;
      if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) actions.Add("Invoke");
      if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) actions.Add("SetValue");
      if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) actions.Add("Toggle");
      if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
        var state = ((ExpandCollapsePattern)pattern).Current.ExpandCollapseState;
        if (state == ExpandCollapseState.Expanded) actions.Add("Collapse");
        if (state == ExpandCollapseState.Collapsed || state == ExpandCollapseState.PartiallyExpanded) actions.Add("Expand");
      }
      if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) actions.Add("Select");
      if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern)) {
        var scroll = ((ScrollPattern)pattern).Current;
        if (scroll.VerticallyScrollable) {
          actions.Add("Scroll Up");
          actions.Add("Scroll Down");
        }
        if (scroll.HorizontallyScrollable) {
          actions.Add("Scroll Left");
          actions.Add("Scroll Right");
        }
      }
      if (element.Current.IsKeyboardFocusable) actions.Add("Raise");
    } catch {
    }
    return actions;
  }

  private static Dictionary<string, object> ElementInfo(AutomationElement element, int index, int depth, RECT windowRect) {
    string name = SafeString(() => element.Current.Name);
    string automationId = SafeString(() => element.Current.AutomationId);
    string className = SafeString(() => element.Current.ClassName);
    string value = TrimForTree(ValueText(element), 800);
    var info = new Dictionary<string, object> {
      { "elementIndex", index },
      { "element_index", index },
      { "depth", depth },
      { "name", name },
      { "controlType", ControlTypeName(element) },
      { "automationId", automationId },
      { "className", className },
      { "boundingRectangle", RectFromAutomation(element, windowRect) },
      { "isEnabled", SafeBool(() => element.Current.IsEnabled, false) },
      { "isOffscreen", SafeBool(() => element.Current.IsOffscreen, true) },
      { "isKeyboardFocusable", SafeBool(() => element.Current.IsKeyboardFocusable, false) },
      { "supportedActions", SupportedActions(element) }
    };
    if (!String.IsNullOrWhiteSpace(value)) info["value"] = value;
    return info;
  }

  private static string FormatElementLine(Dictionary<string, object> info) {
    var rect = (Dictionary<string, object>)info["boundingRectangle"];
    string name = TrimForTree((string)info["name"], 120);
    string value = info.ContainsKey("value") ? TrimForTree((string)info["value"], 120) : "";
    var actions = (List<string>)info["supportedActions"];
    var sb = new StringBuilder();
    sb.Append(new String(' ', ((int)info["depth"]) * 2));
    sb.Append("[");
    sb.Append(info["element_index"]);
    sb.Append("] ");
    sb.Append(info["controlType"]);
    if (!String.IsNullOrWhiteSpace(name)) {
      sb.Append(" ");
      sb.Append(Quote(name));
    }
    if (!String.IsNullOrWhiteSpace(value) && value != name) {
      sb.Append(" value=");
      sb.Append(Quote(value));
    }
    sb.Append(" (x=");
    sb.Append(rect["x"]);
    sb.Append(", y=");
    sb.Append(rect["y"]);
    sb.Append(", w=");
    sb.Append(rect["width"]);
    sb.Append(", h=");
    sb.Append(rect["height"]);
    sb.Append(")");
    if (actions.Count > 0) {
      sb.Append(" actions=");
      sb.Append(String.Join(",", actions.ToArray()));
    }
    if (!(bool)info["isEnabled"]) sb.Append(" disabled");
    if ((bool)info["isOffscreen"]) sb.Append(" offscreen");
    return sb.ToString();
  }

  private static IntPtr HwndFromId(string id) {
    if (String.IsNullOrWhiteSpace(id)) throw new Exception("windowId is required.");
    long value;
    if (!Int64.TryParse(id.Trim(), out value)) throw new Exception("Invalid windowId: " + id);
    return new IntPtr(value);
  }

  private static string WindowTitle(IntPtr hwnd) {
    var sb = new StringBuilder(512);
    GetWindowText(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  private static Dictionary<string, object> WindowInfo(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) throw new Exception("Window is unavailable.");
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) throw new Exception("Failed to read window bounds.");
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    string processName = null;
    string processPath = null;
    try {
      var process = Process.GetProcessById((int)pid);
      processName = process.ProcessName;
      try {
        processPath = process.MainModule.FileName;
      } catch {
        processPath = null;
      }
    } catch {
      processName = null;
    }
    string title = WindowTitle(hwnd);
    string app = !String.IsNullOrWhiteSpace(processPath) ? "process:" + processPath : "process:" + (processName ?? "unknown");
    return new Dictionary<string, object> {
      { "id", hwnd.ToInt64().ToString() },
      { "app", app },
      { "title", title },
      { "processId", pid == 0 ? (object)null : (int)pid },
      { "processName", processName },
      { "processPath", processPath },
      { "bounds", Rect(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top) },
      { "visible", IsWindowVisible(hwnd) },
      { "isMinimized", IsIconic(hwnd) },
      { "isProtected", IsProtectedWindow(processName, title) }
    };
  }

  private static IntPtr RequireWindow(string windowId) {
    IntPtr hwnd = HwndFromId(windowId);
    if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd)) throw new Exception("Window is no longer visible: " + windowId);
    string title = WindowTitle(hwnd);
    if (String.IsNullOrWhiteSpace(title)) throw new Exception("Window no longer has a targetable title: " + windowId);
    return hwnd;
  }

  private static IntPtr RequireTargetableWindow(string windowId) {
    IntPtr hwnd = RequireWindow(windowId);
    var info = WindowInfo(hwnd);
    if ((bool)info["isProtected"]) throw new Exception("Cannot target protected window.");
    return hwnd;
  }

  private static RECT RequireWindowRect(IntPtr hwnd) {
    RECT rect;
    if (!GetWindowRect(hwnd, out rect)) throw new Exception("Failed to read window bounds.");
    if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) throw new Exception("Window bounds are empty.");
    return rect;
  }

  private static void ActivateWindowInternal(IntPtr hwnd) {
    ShowWindow(hwnd, SW_RESTORE);
    SetForegroundWindow(hwnd);
    Thread.Sleep(150);
  }

  private static Dictionary<string, object> WithSelectedWindow(IntPtr hwnd) {
    var result = State();
    result["selectedWindow"] = WindowInfo(hwnd);
    return result;
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

  private static bool IsProtectedProcessName(string processName) {
    string normalized = (processName ?? "").Trim().ToLowerInvariant();
    if (normalized.EndsWith(".exe")) normalized = normalized.Substring(0, normalized.Length - 4);
    return normalized == "cmd" ||
      normalized == "powershell" ||
      normalized == "pwsh" ||
      normalized == "windowsterminal" ||
      normalized == "wt" ||
      normalized == "conhost" ||
      normalized == "openconsole" ||
      normalized == "bash" ||
      normalized == "wsl" ||
      normalized.Contains("t3code") ||
      normalized.Contains("codex");
  }

  private static bool IsProtectedWindow(string processName, string title) {
    string normalizedTitle = (title ?? "").Trim().ToLowerInvariant();
    return IsProtectedProcessName(processName) ||
      normalizedTitle.Contains("t3 code") ||
      normalizedTitle.Contains("codex");
  }

  public static Dictionary<string, object> FocusApp(string query) {
    string needle = (query ?? "").Trim().ToLowerInvariant();
    if (needle.Length == 0) throw new Exception("app is required.");
    IntPtr best = IntPtr.Zero;
    string bestTitle = "";
    string bestProcessName = "";

    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      if (best != IntPtr.Zero) return false;
      if (!IsWindowVisible(hwnd)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(hwnd, sb, sb.Capacity);
      string title = sb.ToString();
      if (String.IsNullOrWhiteSpace(title)) return true;
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      string processName = "";
      try {
        processName = Process.GetProcessById((int)pid).ProcessName;
      } catch {
        processName = "";
      }
      if (IsProtectedWindow(processName, title)) return true;
      string haystack = (title + " " + processName).ToLowerInvariant();
      if (haystack.Contains(needle)) {
        best = hwnd;
        bestTitle = title;
        bestProcessName = processName;
        return false;
      }
      return true;
    }, IntPtr.Zero);

    if (best == IntPtr.Zero) throw new Exception("No visible app window matched: " + query);
    ShowWindow(best, SW_RESTORE);
    SetForegroundWindow(best);
    Thread.Sleep(250);
    var result = State();
    result["focusedWindow"] = new Dictionary<string, object> {
      { "title", bestTitle },
      { "processName", bestProcessName }
    };
    result["selectedWindow"] = WindowInfo(best);
    return result;
  }

  public static Dictionary<string, object> ListWindows(string query) {
    string needle = (query ?? "").Trim().ToLowerInvariant();
    var windows = new List<Dictionary<string, object>>();

    EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
      if (!IsWindowVisible(hwnd)) return true;
      string title = WindowTitle(hwnd);
      if (String.IsNullOrWhiteSpace(title)) return true;
      Dictionary<string, object> info;
      try {
        info = WindowInfo(hwnd);
      } catch {
        return true;
      }
      string processName = info.ContainsKey("processName") && info["processName"] != null ? (string)info["processName"] : "";
      if (IsProtectedWindow(processName, title)) return true;
      string haystack = (title + " " + processName).ToLowerInvariant();
      if (needle.Length == 0 || haystack.Contains(needle)) {
        windows.Add(info);
      }
      return true;
    }, IntPtr.Zero);

    var result = State();
    result["windows"] = windows;
    return result;
  }

  public static Dictionary<string, object> ListApps(string query) {
    string needle = (query ?? "").Trim().ToLowerInvariant();
    var apps = new Dictionary<string, Dictionary<string, object>>();
    var windowsResult = ListWindows(query);
    var windows = (List<Dictionary<string, object>>)windowsResult["windows"];
    foreach (var window in windows) {
      string processName = window.ContainsKey("processName") && window["processName"] != null ? (string)window["processName"] : "Unknown";
      string key = processName.ToLowerInvariant();
      if (needle.Length > 0 && !(processName.ToLowerInvariant().Contains(needle) || ((string)window["title"]).ToLowerInvariant().Contains(needle))) continue;
      if (!apps.ContainsKey(key)) {
        apps[key] = new Dictionary<string, object> {
          { "id", key },
          { "displayName", processName },
          { "processName", processName },
          { "windows", new List<Dictionary<string, object>>() }
        };
      }
      ((List<Dictionary<string, object>>)apps[key]["windows"]).Add(window);
    }
    var result = State();
    result["apps"] = new List<Dictionary<string, object>>(apps.Values);
    return result;
  }

  public static Dictionary<string, object> SelectWindow(string windowId) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    return WithSelectedWindow(hwnd);
  }

  public static Dictionary<string, object> ActivateWindow(string windowId) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    return WithSelectedWindow(hwnd);
  }

  public static Dictionary<string, object> WindowScreenshot(string windowId, string path) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    if (IsIconic(hwnd)) throw new Exception("Window is minimized; activate it before taking a window screenshot.");
    RECT rect = RequireWindowRect(hwnd);
    int width = rect.Right - rect.Left;
    int height = rect.Bottom - rect.Top;
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        IntPtr hdc = graphics.GetHdc();
        try {
          bool printed = PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT);
          if (!printed) throw new Exception("PrintWindow failed.");
        } finally {
          graphics.ReleaseHdc(hdc);
        }
      }
      bitmap.Save(path, ImageFormat.Png);
    }
    var result = WithSelectedWindow(hwnd);
    result["screenshot"] = new Dictionary<string, object> {
      { "path", path },
      { "originX", rect.Left },
      { "originY", rect.Top },
      { "width", width },
      { "height", height },
      { "scaleFactor", 1 },
      { "coordinateSpace", "window" },
      { "id", "window-0" },
      { "zIndex", 0 },
      { "captureMethod", "printWindow" },
      { "fallbackReason", "Windows.Graphics.Capture backend is not available in the current T3 Windows helper; using PrintWindow." }
    };
    return result;
  }

  private static void TraverseAccessibility(
    AutomationElement element,
    int depth,
    RECT windowRect,
    List<Dictionary<string, object>> elements,
    List<string> lines,
    Dictionary<int, AutomationElement> cache
  ) {
    if (element == null || elements.Count >= MAX_ACCESSIBILITY_ELEMENTS || depth > MAX_ACCESSIBILITY_DEPTH) return;
    try {
      int index = elements.Count;
      var info = ElementInfo(element, index, depth, windowRect);
      elements.Add(info);
      lines.Add(FormatElementLine(info));
      cache[index] = element;

      if (elements.Count >= MAX_ACCESSIBILITY_ELEMENTS) return;
      var walker = TreeWalker.ControlViewWalker;
      AutomationElement child = walker.GetFirstChild(element);
      while (child != null && elements.Count < MAX_ACCESSIBILITY_ELEMENTS) {
        TraverseAccessibility(child, depth + 1, windowRect, elements, lines, cache);
        child = walker.GetNextSibling(child);
      }
    } catch {
    }
  }

  private static AutomationElement RootElementForWindow(IntPtr hwnd) {
    try {
      var root = AutomationElement.FromHandle(hwnd);
      if (root == null) throw new Exception("UI Automation did not return a root element.");
      return root;
    } catch (Exception ex) {
      throw new Exception("Failed to read accessibility tree: " + ex.Message);
    }
  }

  private static AutomationElement ElementFromLatestSnapshot(string windowId, int elementIndex) {
    if (elementIndex < 0) throw new Exception("element_index must be >= 0.");
    Dictionary<int, AutomationElement> cache;
    if (!LastAccessibilityElementsByWindow.TryGetValue(windowId, out cache)) {
      throw new Exception("No accessibility snapshot is available for this window. Call computer_get_window_state with includeText=true first.");
    }
    AutomationElement element;
    if (!cache.TryGetValue(elementIndex, out element)) {
      throw new Exception("Element index is not available in the latest accessibility snapshot: " + elementIndex);
    }
    return element;
  }

  public static Dictionary<string, object> AccessibilitySnapshot(string windowId) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    RECT rect = RequireWindowRect(hwnd);
    var window = WindowInfo(hwnd);
    var root = RootElementForWindow(hwnd);
    var elements = new List<Dictionary<string, object>>();
    var lines = new List<string>();
    var cache = new Dictionary<int, AutomationElement>();
    string appName = window.ContainsKey("processName") && window["processName"] != null ? (string)window["processName"] : "";
    string title = window.ContainsKey("title") && window["title"] != null ? (string)window["title"] : "";

    lines.Add("Window: " + Quote(title) + ", App: " + appName);
    TraverseAccessibility(root, 0, rect, elements, lines, cache);
    if (elements.Count >= MAX_ACCESSIBILITY_ELEMENTS) {
      lines.Add("Tree truncated after " + MAX_ACCESSIBILITY_ELEMENTS + " elements.");
    }
    LastAccessibilityElementsByWindow[windowId] = cache;

    string focusedLine = null;
    string selectedText = null;
    string documentText = null;
    try {
      var focused = AutomationElement.FocusedElement;
      if (focused != null && IsDescendantOf(focused, root)) {
        int focusedIndex = -1;
        foreach (var pair in cache) {
          if (SameRuntimeId(pair.Value, focused)) {
            focusedIndex = pair.Key;
            break;
          }
        }
        if (focusedIndex >= 0) {
          focusedLine = FormatElementLine(ElementInfo(focused, focusedIndex, 0, rect));
          selectedText = TrimForTree(SelectedText(focused), 4000);
          documentText = TrimForTree(ValueText(focused), 8000);
        }
      }
    } catch {
    }

    if (!String.IsNullOrWhiteSpace(selectedText)) {
      lines.Add("Selected text: " + selectedText);
    }
    if (!String.IsNullOrWhiteSpace(documentText)) {
      lines.Add("Document text: " + documentText);
    }
    if (!String.IsNullOrWhiteSpace(focusedLine)) {
      lines.Add("The focused UI element is " + focusedLine);
    }

    var accessibility = new Dictionary<string, object> {
      { "tree", String.Join("\n", lines.ToArray()) },
      { "elements", elements },
      { "selected_elements", new List<string>() },
      { "elementCount", elements.Count },
      { "truncated", elements.Count >= MAX_ACCESSIBILITY_ELEMENTS }
    };
    if (!String.IsNullOrWhiteSpace(focusedLine)) accessibility["focused_element"] = focusedLine;
    if (!String.IsNullOrWhiteSpace(selectedText)) accessibility["selected_text"] = selectedText;
    if (!String.IsNullOrWhiteSpace(documentText)) accessibility["document_text"] = documentText;

    var result = WithSelectedWindow(hwnd);
    result["window"] = window;
    result["accessibility"] = accessibility;
    return result;
  }

  public static Dictionary<string, object> WindowState(string windowId, string path, bool includeScreenshot, bool includeText) {
    if (!includeScreenshot && !includeText) throw new Exception("computer_get_window_state requires includeScreenshot, includeText, or both.");
    IntPtr hwnd = RequireTargetableWindow(windowId);
    var state = WithSelectedWindow(hwnd);
    state["window"] = WindowInfo(hwnd);
    if (includeScreenshot) {
      var screenshot = WindowScreenshot(windowId, path);
      state["screenshot"] = screenshot["screenshot"];
      state["selectedWindow"] = screenshot["selectedWindow"];
      state["window"] = screenshot["selectedWindow"];
    }
    if (includeText) {
      var accessibility = AccessibilitySnapshot(windowId);
      state["accessibility"] = accessibility["accessibility"];
      state["selectedWindow"] = accessibility["selectedWindow"];
      state["window"] = accessibility["selectedWindow"];
    } else {
      state["accessibility"] = null;
    }
    return state;
  }

  public static Dictionary<string, object> ClickElement(string windowId, int elementIndex, string button, int count) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    RECT rect = RequireWindowRect(hwnd);
    var element = ElementFromLatestSnapshot(windowId, elementIndex);
    var bounds = element.Current.BoundingRectangle;
    if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0) throw new Exception("Element has no clickable bounding rectangle.");
    int x = (int)Math.Round(bounds.X + bounds.Width / 2);
    int y = (int)Math.Round(bounds.Y + bounds.Height / 2);
    Click(x, y, button, count);
    return WithSelectedWindow(hwnd);
  }

  public static Dictionary<string, object> SetElementValue(string windowId, int elementIndex, string value) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    var element = ElementFromLatestSnapshot(windowId, elementIndex);
    object pattern;
    if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
      var valuePattern = (ValuePattern)pattern;
      if (valuePattern.Current.IsReadOnly) throw new Exception("Element value is read-only.");
      valuePattern.SetValue(value ?? "");
      return WithSelectedWindow(hwnd);
    }
    if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern) || element.Current.IsKeyboardFocusable) {
      element.SetFocus();
      Hotkey(new string[] { "Control", "A" });
      SendUnicodeText(value ?? "");
      return WithSelectedWindow(hwnd);
    }
    throw new Exception("Element does not support SetValue and is not keyboard focusable.");
  }

  public static Dictionary<string, object> PerformSecondaryAction(string windowId, int elementIndex, string action) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    var element = ElementFromLatestSnapshot(windowId, elementIndex);
    string normalized = (action ?? "").Trim().ToLowerInvariant();
    if (normalized.Length == 0) throw new Exception("action is required.");
    object pattern;
    if (normalized == "raise" || normalized == "focus") {
      element.SetFocus();
      return WithSelectedWindow(hwnd);
    }
    if (normalized == "invoke" || normalized == "press" || normalized == "click") {
      if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) {
        ((InvokePattern)pattern).Invoke();
        return WithSelectedWindow(hwnd);
      }
    }
    if (normalized == "toggle") {
      if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) {
        ((TogglePattern)pattern).Toggle();
        return WithSelectedWindow(hwnd);
      }
    }
    if (normalized == "select") {
      if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) {
        ((SelectionItemPattern)pattern).Select();
        return WithSelectedWindow(hwnd);
      }
    }
    if (normalized == "expand" || normalized == "collapse") {
      if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
        var expand = (ExpandCollapsePattern)pattern;
        if (normalized == "expand") expand.Expand(); else expand.Collapse();
        return WithSelectedWindow(hwnd);
      }
    }
    if (normalized.StartsWith("scroll")) {
      if (element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern)) {
        var scroll = (ScrollPattern)pattern;
        if (normalized.Contains("up")) scroll.Scroll(ScrollAmount.NoAmount, ScrollAmount.LargeDecrement);
        else if (normalized.Contains("down")) scroll.Scroll(ScrollAmount.NoAmount, ScrollAmount.LargeIncrement);
        else if (normalized.Contains("left")) scroll.Scroll(ScrollAmount.LargeDecrement, ScrollAmount.NoAmount);
        else if (normalized.Contains("right")) scroll.Scroll(ScrollAmount.LargeIncrement, ScrollAmount.NoAmount);
        else throw new Exception("Scroll action must specify Up, Down, Left, or Right.");
        return WithSelectedWindow(hwnd);
      }
    }
    throw new Exception("Element does not support secondary action: " + action);
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

  public static Dictionary<string, object> MoveMouseInWindow(string windowId, int x, int y) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    RECT rect = RequireWindowRect(hwnd);
    SetCursorPos(rect.Left + x, rect.Top + y);
    return WithSelectedWindow(hwnd);
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

  public static Dictionary<string, object> ClickInWindow(string windowId, int x, int y, string button, int count) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    RECT rect = RequireWindowRect(hwnd);
    Click(rect.Left + x, rect.Top + y, button, count);
    return WithSelectedWindow(hwnd);
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

  public static Dictionary<string, object> DragInWindow(string windowId, int fromX, int fromY, int toX, int toY, int durationMs) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    RECT rect = RequireWindowRect(hwnd);
    Drag(rect.Left + fromX, rect.Top + fromY, rect.Left + toX, rect.Top + toY, durationMs);
    return WithSelectedWindow(hwnd);
  }

  public static Dictionary<string, object> Scroll(int x, int y, int deltaX, int deltaY) {
    SetCursorPos(x, y);
    if (deltaY != 0) SendMouse(MOUSEEVENTF_WHEEL, unchecked((uint)deltaY));
    if (deltaX != 0) SendMouse(MOUSEEVENTF_HWHEEL, unchecked((uint)deltaX));
    return State();
  }

  public static Dictionary<string, object> ScrollInWindow(string windowId, int x, int y, int deltaX, int deltaY) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    RECT rect = RequireWindowRect(hwnd);
    Scroll(rect.Left + x, rect.Top + y, deltaX, deltaY);
    return WithSelectedWindow(hwnd);
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

  public static Dictionary<string, object> PressInWindow(string windowId, string key) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    Press(key);
    return WithSelectedWindow(hwnd);
  }

  public static Dictionary<string, object> Hotkey(string[] keys) {
    if (keys == null || keys.Length == 0) throw new Exception("keys is required.");
    var vks = new List<ushort>();
    foreach (var key in keys) vks.Add(KeyToVk(key));
    for (int i = 0; i < vks.Count; i++) SendKey(vks[i], 0, 0);
    for (int i = vks.Count - 1; i >= 0; i--) SendKey(vks[i], 0, KEYEVENTF_KEYUP);
    return State();
  }

  public static Dictionary<string, object> HotkeyInWindow(string windowId, string[] keys) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    Hotkey(keys);
    return WithSelectedWindow(hwnd);
  }

  public static Dictionary<string, object> TypeInWindow(string windowId, string text) {
    IntPtr hwnd = RequireTargetableWindow(windowId);
    ActivateWindowInternal(hwnd);
    SendUnicodeText(text);
    return WithSelectedWindow(hwnd);
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
      "listApps" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::ListApps([string]$args.query) }
      }
      "listWindows" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::ListWindows([string]$args.query) }
      }
      "selectWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::SelectWindow([string]$args.windowId) }
      }
      "activateWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::ActivateWindow([string]$args.windowId) }
      }
      "windowScreenshot" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::WindowScreenshot([string]$args.windowId, [string]$args.path) }
      }
      "accessibilitySnapshot" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::AccessibilitySnapshot([string]$args.windowId) }
      }
      "windowState" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::WindowState([string]$args.windowId, [string]$args.path, [bool]$args.includeScreenshot, [bool]$args.includeText) }
      }
      "clickElement" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::ClickElement([string]$args.windowId, [int]$args.elementIndex, [string]$args.button, [int]$args.count) }
      }
      "setElementValue" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::SetElementValue([string]$args.windowId, [int]$args.elementIndex, [string]$args.value) }
      }
      "performSecondaryAction" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::PerformSecondaryAction([string]$args.windowId, [int]$args.elementIndex, [string]$args.action) }
      }
      "moveMouse" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::MoveMouse([int]$args.x, [int]$args.y) }
      }
      "moveMouseInWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::MoveMouseInWindow([string]$args.windowId, [int]$args.x, [int]$args.y) }
      }
      "focusApp" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::FocusApp([string]$args.app) }
      }
      "click" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Click([int]$args.x, [int]$args.y, [string]$args.button, [int]$args.count) }
      }
      "clickInWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::ClickInWindow([string]$args.windowId, [int]$args.x, [int]$args.y, [string]$args.button, [int]$args.count) }
      }
      "drag" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Drag([int]$args.fromX, [int]$args.fromY, [int]$args.toX, [int]$args.toY, [int]$args.durationMs) }
      }
      "dragInWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::DragInWindow([string]$args.windowId, [int]$args.fromX, [int]$args.fromY, [int]$args.toX, [int]$args.toY, [int]$args.durationMs) }
      }
      "scroll" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Scroll([int]$args.x, [int]$args.y, [int]$args.deltaX, [int]$args.deltaY) }
      }
      "scrollInWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::ScrollInWindow([string]$args.windowId, [int]$args.x, [int]$args.y, [int]$args.deltaX, [int]$args.deltaY) }
      }
      "type" {
        [T3ComputerNative]::SendUnicodeText([string]$args.text)
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::State() }
      }
      "typeInWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::TypeInWindow([string]$args.windowId, [string]$args.text) }
      }
      "press" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Press([string]$args.key) }
      }
      "pressInWindow" {
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::PressInWindow([string]$args.windowId, [string]$args.key) }
      }
      "hotkey" {
        $keys = @($args.keys | ForEach-Object { [string]$_ })
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::Hotkey([string[]]$keys) }
      }
      "hotkeyInWindow" {
        $keys = @($args.keys | ForEach-Object { [string]$_ })
        Write-Json @{ id = $request.id; ok = $true; result = [T3ComputerNative]::HotkeyInWindow([string]$args.windowId, [string[]]$keys) }
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
