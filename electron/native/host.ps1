$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class CocoWindow {
    public string hwnd { get; set; }
    public int pid { get; set; }
    public string process { get; set; }
    public string title { get; set; }
    public string className { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int w { get; set; }
    public int h { get; set; }
}

public class CocoPlaced {
    public string hwnd { get; set; }
    public bool alive { get; set; }
    public string title { get; set; }
}

public class CocoShot {
    public string path { get; set; }
    public int width { get; set; }
    public int height { get; set; }
}

public static class CocoNative {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct PLACEMENT { public int length, flags, showCmd; public POINT min, max; public RECT normal; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x; public int y; public uint data; public uint flags; public uint time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
    delegate bool EnumProc(IntPtr handle, IntPtr parameter);

    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr handle, uint command);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle, out RECT rect);
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr handle, ref PLACEMENT placement);
    [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr handle, ref PLACEMENT placement);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr handle, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr handle, int index, IntPtr value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr handle, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr handle, IntPtr region, bool redraw);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr handle, IntPtr region);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr region, out RECT rect);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr handle, IntPtr dc, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr handle, int attribute, out int value, int size);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr handle, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr handle);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint source, uint target, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short VkKeyScan(char ch);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);

    const int GWL_STYLE = -16, GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8;
    const long WS_FRAME = 0x00C00000L | 0x00040000L | 0x00020000L | 0x00010000L | 0x00080000L;
    const long WS_EX_FRAME = 0x00040000L | 0x00000100L | 0x00000200L | 0x00000001L | 0x00020000L;
    const long WS_STATE = 0x20000000L | 0x01000000L;
    const long WS_EX_TOOLWINDOW = 0x80L, WS_EX_APPWINDOW = 0x40000L;
    const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40, SWP_NOOWNERZORDER = 0x200;

    class Managed { public long style, exStyle, owner; public PLACEMENT placement; public bool hasTarget, clipped; public int tx, ty, tw, th; public RECT applied; }
    static readonly Dictionary<long, Managed> managed = new Dictionary<long, Managed>();
    static readonly Dictionary<int, string> names = new Dictionary<int, string>();
    static readonly HashSet<string> shellClasses = new HashSet<string> { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };

    public static void Init() {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch {}
        SetProcessDPIAware();
    }

    static string Text(IntPtr handle) { var text = new StringBuilder(512); GetWindowText(handle, text, 512); return text.ToString(); }
    static string ClassOf(IntPtr handle) { var text = new StringBuilder(256); GetClassName(handle, text, 256); return text.ToString(); }
    static int Pid(IntPtr handle) { uint pid; GetWindowThreadProcessId(handle, out pid); return (int)pid; }
    static string ProcessName(int pid) {
        string name;
        if (names.TryGetValue(pid, out name)) return name;
        try { name = Process.GetProcessById(pid).ProcessName; } catch { name = ""; }
        names[pid] = name;
        return name;
    }
    static IntPtr Handle(long id) {
        IntPtr handle = new IntPtr(id);
        if (!IsWindow(handle)) throw new Exception("窗口已经关闭。");
        return handle;
    }

    public static List<CocoWindow> Windows(int excludePid) {
        var list = new List<CocoWindow>();
        EnumWindows(delegate (IntPtr handle, IntPtr parameter) {
            try {
                if (!IsWindowVisible(handle) || GetWindow(handle, 4) != IntPtr.Zero) return true;
                long ex = GetWindowLongPtr(handle, GWL_EXSTYLE).ToInt64();
                if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return true;
                int cloaked;
                if (DwmGetWindowAttribute(handle, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
                string title = Text(handle), className = ClassOf(handle);
                if (title.Length == 0 || shellClasses.Contains(className)) return true;
                RECT r; GetWindowRect(handle, out r);
                // Minimized windows report a tiny rect off screen but are still worth adopting.
                if (!IsIconic(handle) && (r.Right - r.Left < 80 || r.Bottom - r.Top < 60)) return true;
                int pid = Pid(handle);
                if (pid == excludePid) return true;
                list.Add(new CocoWindow { hwnd = handle.ToInt64().ToString(), pid = pid, process = ProcessName(pid), title = title, className = className, x = r.Left, y = r.Top, w = r.Right - r.Left, h = r.Bottom - r.Top });
            } catch {}
            return true;
        }, IntPtr.Zero);
        return list;
    }

    // WSA draws a custom title bar with its own non-client hit testing. Removing its
    // frame moves the Android pixels but leaves invisible caption hit targets on top.
    // Keep that frame so rendered pixels and Windows input agree.
    static bool PreserveFrame(IntPtr handle) {
        return String.Equals(ProcessName(Pid(handle)), "WsaClient", StringComparison.OrdinalIgnoreCase);
    }

    // Owned by coco: follows its z-order and minimizes with it. Ordinary apps are borderless.
    public static void Attach(long id, long owner) {
        IntPtr handle = Handle(id);
        if (!managed.ContainsKey(id)) {
            var saved = new Managed { style = GetWindowLongPtr(handle, GWL_STYLE).ToInt64(), exStyle = GetWindowLongPtr(handle, GWL_EXSTYLE).ToInt64(), owner = GetWindowLongPtr(handle, GWLP_HWNDPARENT).ToInt64() };
            saved.placement.length = Marshal.SizeOf(typeof(PLACEMENT));
            GetWindowPlacement(handle, ref saved.placement);
            managed[id] = saved;
        }
        if (IsIconic(handle) || IsZoomed(handle)) ShowWindow(handle, 9);
        if (!PreserveFrame(handle)) {
            SetWindowLongPtr(handle, GWL_STYLE, new IntPtr(GetWindowLongPtr(handle, GWL_STYLE).ToInt64() & ~WS_FRAME));
            SetWindowLongPtr(handle, GWL_EXSTYLE, new IntPtr(GetWindowLongPtr(handle, GWL_EXSTYLE).ToInt64() & ~WS_EX_FRAME));
        }
        SetWindowLongPtr(handle, GWLP_HWNDPARENT, new IntPtr(owner));
        SetWindowPos(handle, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        ShowWindow(handle, 0);
        ShowWindow(handle, 8);
    }

    public static void Release(long id) {
        Managed saved;
        if (!managed.TryGetValue(id, out saved)) return;
        managed.Remove(id);
        IntPtr handle = new IntPtr(id);
        if (!IsWindow(handle)) return;
        SetWindowRgn(handle, IntPtr.Zero, true);
        SetWindowLongPtr(handle, GWLP_HWNDPARENT, new IntPtr(saved.owner));
        SetWindowLongPtr(handle, GWL_STYLE, new IntPtr(saved.style & ~WS_STATE));
        SetWindowLongPtr(handle, GWL_EXSTYLE, new IntPtr(saved.exStyle));
        SetWindowPos(handle, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        // Back to where it was, in the state it was in (normal, minimized or maximized).
        PLACEMENT placement = saved.placement;
        if (placement.showCmd == 0) placement.showCmd = 1;
        SetWindowPlacement(handle, ref placement);
        // SetWindowPlacement leaves a hidden window hidden (e.g. one from a background workspace).
        if (!IsWindowVisible(handle)) ShowWindow(handle, placement.showCmd == 2 ? 7 : placement.showCmd == 3 ? 3 : 8);
    }

    // Idempotent: called on every layout change and periodically, so a window dragged or maximized by its own title bar snaps back.
    public static CocoPlaced Place(long id, int x, int y, int width, int height, bool show) {
        IntPtr handle = new IntPtr(id);
        var result = new CocoPlaced { hwnd = id.ToString(), alive = IsWindow(handle) };
        if (!result.alive) { managed.Remove(id); return result; }
        result.title = Text(handle);
        Managed m;
        if (!managed.TryGetValue(id, out m)) return result;
        if (!show) { if (IsWindowVisible(handle)) ShowWindow(handle, 0); return result; }
        if (IsIconic(handle)) ShowWindow(handle, 4);
        else if (IsZoomed(handle)) ShowWindow(handle, 9);
        RECT current; GetWindowRect(handle, out current);
        bool visible = IsWindowVisible(handle);
        bool same = m.hasTarget && m.tx == x && m.ty == y && m.tw == width && m.th == height;
        if (visible && same && Equal(current, m.applied)) return result;
        SetWindowPos(handle, IntPtr.Zero, x, y, width, height, SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE | (visible ? 0 : SWP_SHOWWINDOW));
        GetWindowRect(handle, out current);
        m.hasTarget = true; m.tx = x; m.ty = y; m.tw = width; m.th = height; m.applied = current;
        // Windows with a larger minimum size are clipped to the tile instead of spilling over coco.
        bool overflow = current.Right - current.Left > width || current.Bottom - current.Top > height;
        if (overflow) { IntPtr region = CreateRectRgn(0, 0, width, height); if (SetWindowRgn(handle, region, true) == 0) DeleteObject(region); }
        else if (m.clipped) SetWindowRgn(handle, IntPtr.Zero, true);
        m.clipped = overflow;
        return result;
    }

    static bool Equal(RECT a, RECT b) { return a.Left == b.Left && a.Top == b.Top && a.Right == b.Right && a.Bottom == b.Bottom; }

    // CreateProcess directly: ShellExecute (Start-Process) can stall in a host whose stdio is redirected.
    public static void Launch(string file, string arguments) {
        var info = new ProcessStartInfo(file, arguments) { UseShellExecute = false, CreateNoWindow = false, RedirectStandardInput = false, RedirectStandardOutput = false, RedirectStandardError = false };
        using (Process.Start(info)) {}
    }

    public static void Close(long id) {
        IntPtr handle = new IntPtr(id);
        managed.Remove(id);
        if (IsWindow(handle)) PostMessage(handle, 0x0010, IntPtr.Zero, IntPtr.Zero);
    }

    // The part of the window the user can see inside its tile; all coordinates the agent uses are relative to it.
    static RECT Area(IntPtr handle) {
        RECT r; GetWindowRect(handle, out r);
        // Layout and input run in separate processes; the managed dictionary is not shared.
        // Read the region actually applied by Windows, including a nonzero crop origin.
        IntPtr region = CreateRectRgn(0, 0, 0, 0);
        if (region == IntPtr.Zero) throw new Exception("无法读取窗口裁剪区域。");
        try {
            int kind = GetWindowRgn(handle, region);
            if (kind == 1) throw new Exception("窗口没有可见区域。");
            if (kind > 1) {
                RECT clip;
                if (GetRgnBox(region, out clip) <= 1) throw new Exception("窗口裁剪区域无效。");
                int left = r.Left, top = r.Top;
                r.Left = Math.Max(r.Left, left + clip.Left);
                r.Top = Math.Max(r.Top, top + clip.Top);
                r.Right = Math.Min(r.Right, left + clip.Right);
                r.Bottom = Math.Min(r.Bottom, top + clip.Bottom);
            }
        } finally { DeleteObject(region); }
        if (r.Right <= r.Left || r.Bottom <= r.Top) throw new Exception("窗口没有可见区域。");
        return r;
    }

    static bool Owns(IntPtr handle, int x, int y) {
        IntPtr at = WindowFromPoint(new POINT { X = x, Y = y });
        if (at == IntPtr.Zero) return false;
        IntPtr root = GetAncestor(at, 2);
        return root == handle || Pid(root) == Pid(handle);
    }

    static void RequireVisible(IntPtr handle) {
        if (!IsWindowVisible(handle) || IsIconic(handle)) throw new Exception("窗口当前不可见。");
    }

    static POINT Point(IntPtr handle, double nx, double ny) {
        RequireVisible(handle);
        if (double.IsNaN(nx) || double.IsNaN(ny) || nx < 0 || nx > 1000 || ny < 0 || ny > 1000) throw new Exception("坐标必须在 0–1000 之间。");
        RECT a = Area(handle);
        var p = new POINT { X = a.Left + (int)Math.Round(nx / 1000.0 * (a.Right - a.Left - 1)), Y = a.Top + (int)Math.Round(ny / 1000.0 * (a.Bottom - a.Top - 1)) };
        if (!Owns(handle, p.X, p.Y)) throw new Exception("目标位置被其他窗口遮挡，请把 coco 放到前台。");
        return p;
    }

    public static CocoShot Capture(long id, int max, string path) {
        IntPtr handle = Handle(id);
        RequireVisible(handle);
        RECT r; GetWindowRect(handle, out r);
        RECT a = Area(handle);
        int w = r.Right - r.Left, h = r.Bottom - r.Top, aw = a.Right - a.Left, ah = a.Bottom - a.Top;
        if (aw <= 0 || ah <= 0) throw new Exception("窗口尺寸无效。");
        double scale = Math.Min(1.0, (double)max / Math.Max(aw, ah));
        int ow = Math.Max(1, (int)Math.Round(aw * scale)), oh = Math.Max(1, (int)Math.Round(ah * scale));
        using (var full = new Bitmap(w, h, PixelFormat.Format32bppArgb))
        using (var output = new Bitmap(ow, oh, PixelFormat.Format24bppRgb))
        using (var g = Graphics.FromImage(output)) {
            bool printed;
            using (var fg = Graphics.FromImage(full)) { IntPtr dc = fg.GetHdc(); try { printed = PrintWindow(handle, dc, 2); } finally { fg.ReleaseHdc(dc); } }
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            if (printed && !Blank(full)) {
                g.DrawImage(full, new Rectangle(0, 0, ow, oh), new Rectangle(a.Left - r.Left, a.Top - r.Top, aw, ah), GraphicsUnit.Pixel);
            } else {
                // Screen pixels are only used when every sample point really shows this window, never what covers it.
                for (int i = 1; i < 4; i++) for (int j = 1; j < 4; j++)
                    if (!Owns(handle, a.Left + aw * i / 4, a.Top + ah * j / 4)) throw new Exception("窗口被遮挡，无法截图。请把 coco 放到前台。");
                using (var screen = new Bitmap(aw, ah, PixelFormat.Format24bppRgb)) {
                    using (var sg = Graphics.FromImage(screen)) sg.CopyFromScreen(a.Left, a.Top, 0, 0, new Size(aw, ah));
                    g.DrawImage(screen, new Rectangle(0, 0, ow, oh));
                }
            }
            var codec = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
            var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
            output.Save(path, codec, parameters);
        }
        return new CocoShot { path = path, width = ow, height = oh };
    }

    static bool Blank(Bitmap image) {
        for (int i = 1; i < 9; i++) for (int j = 1; j < 9; j++) {
            Color c = image.GetPixel(image.Width * i / 9, image.Height * j / 9);
            if (c.R + c.G + c.B > 24) return false;
        }
        return true;
    }

    public static bool Focus(long id) {
        IntPtr handle = Handle(id);
        if (Foreground(handle)) return true;
        for (int attempt = 0; attempt < 2 && !Foreground(handle); attempt++) {
            if (attempt == 1) { mouse_event(0, 0, 0, 0, UIntPtr.Zero); Press("ALT"); }
            uint ignored;
            uint current = GetCurrentThreadId();
            uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
            bool attached = current != foreground && AttachThreadInput(current, foreground, true);
            try { BringWindowToTop(handle); SetForegroundWindow(handle); } finally { if (attached) AttachThreadInput(current, foreground, false); }
            Thread.Sleep(60);
        }
        return Foreground(handle);
    }

    static bool Foreground(IntPtr handle) {
        IntPtr fg = GetForegroundWindow();
        // WSA and multi-window apps can share a process. A sibling HWND is not this tile.
        return fg == handle || (fg != IntPtr.Zero && GetAncestor(fg, 2) == handle);
    }

    static void RequireFocus(long id) {
        IntPtr handle = Handle(id);
        RequireVisible(handle);
        if (!Focus(id)) throw new Exception("Windows 没有允许切换焦点，请先点击一下该应用。");
    }

    public static void Click(long id, double nx, double ny, string button, int count) {
        IntPtr handle = Handle(id);
        Point(handle, nx, ny); // Validate before activating or moving anything.
        RequireFocus(id); // Otherwise WM_MOUSEACTIVATE can consume the first click.
        POINT p = Point(handle, nx, ny);
        uint down = button == "right" ? 0x0008u : 0x0002u, up = button == "right" ? 0x0010u : 0x0004u;
        SetCursorPos(p.X, p.Y);
        Thread.Sleep(30);
        for (int i = 0; i < Math.Max(1, count); i++) {
            Point(handle, nx, ny);
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            // WSA/remote renderers need DOWN and UP to survive separate input frames.
            try { Thread.Sleep(80); } finally { mouse_event(up, 0, 0, 0, UIntPtr.Zero); }
            if (count > 1) Thread.Sleep(70);
        }
    }

    public static void Move(long id, double nx, double ny) { POINT p = Point(Handle(id), nx, ny); SetCursorPos(p.X, p.Y); }

    public static void Drag(long id, double x1, double y1, double x2, double y2) {
        IntPtr handle = Handle(id);
        Point(handle, x1, y1); Point(handle, x2, y2);
        RequireFocus(id);
        POINT a = Point(handle, x1, y1), b = Point(handle, x2, y2);
        SetCursorPos(a.X, a.Y);
        Thread.Sleep(40);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        for (int i = 1; i <= 16; i++) { SetCursorPos(a.X + (b.X - a.X) * i / 16, a.Y + (b.Y - a.Y) * i / 16); Thread.Sleep(14); }
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Scroll(long id, double nx, double ny, int amount) {
        POINT p = Point(Handle(id), nx, ny);
        SetCursorPos(p.X, p.Y);
        Thread.Sleep(30);
        mouse_event(0x0800, 0, 0, amount, UIntPtr.Zero);
    }

    public static void Type(long id, string text) {
        RequireFocus(id);
        var inputs = new List<INPUT>();
        // Paced per character: rich text controls drop or repeat VK_PACKET input that arrives in one burst.
        foreach (char ch in text) {
            if (ch == '\r') continue;
            if (ch == '\n' || ch == '\t') { Press(ch == '\n' ? "ENTER" : "TAB"); Thread.Sleep(40); continue; }
            inputs.Clear();
            inputs.Add(new INPUT { type = 1, data = new UNION { key = new KEYBDINPUT { scan = ch, flags = 0x0004 } } });
            inputs.Add(new INPUT { type = 1, data = new UNION { key = new KEYBDINPUT { scan = ch, flags = 0x0006 } } });
            if (SendInput(2, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT))) != 2) throw new Exception("Windows 拒绝了文字输入，目标应用可能以更高权限运行。");
            Thread.Sleep(6);
        }
    }

    public static void Key(long id, string chord) { RequireFocus(id); Press(chord); }

    static ushort Vk(string name, out bool extended) {
        extended = false;
        string key = name.Trim().ToUpperInvariant();
        switch (key) {
            case "CTRL": case "CONTROL": return 0x11;
            case "ALT": return 0x12;
            case "SHIFT": return 0x10;
            case "WIN": case "META": case "CMD": extended = true; return 0x5B;
            case "ENTER": case "RETURN": return 0x0D;
            case "TAB": return 0x09;
            case "ESC": case "ESCAPE": return 0x1B;
            case "SPACE": return 0x20;
            case "BACKSPACE": return 0x08;
            case "CAPSLOCK": return 0x14;
            case "PLUS": return 0xBB;
            case "MINUS": return 0xBD;
        }
        extended = true;
        switch (key) {
            case "DELETE": case "DEL": return 0x2E;
            case "INSERT": return 0x2D;
            case "UP": return 0x26;
            case "DOWN": return 0x28;
            case "LEFT": return 0x25;
            case "RIGHT": return 0x27;
            case "HOME": return 0x24;
            case "END": return 0x23;
            case "PAGEUP": return 0x21;
            case "PAGEDOWN": return 0x22;
            case "APPS": case "MENU": return 0x5D;
        }
        extended = false;
        int fn;
        if (key.Length > 1 && key[0] == 'F' && int.TryParse(key.Substring(1), out fn) && fn >= 1 && fn <= 24) return (ushort)(0x6F + fn);
        if (key.Length == 1) { short scan = VkKeyScan(name.Trim()[0]); if (scan != -1) return (ushort)(scan & 0xFF); }
        throw new Exception("不支持的按键：" + name);
    }

    static INPUT KeyInput(ushort vk, bool extended, bool up) {
        uint flags = (extended ? 0x0001u : 0) | (up ? 0x0002u : 0);
        return new INPUT { type = 1, data = new UNION { key = new KEYBDINPUT { vk = vk, scan = (ushort)MapVirtualKey(vk, 0), flags = flags } } };
    }

    static void Press(string chord) {
        string[] parts = chord.Split('+');
        var keys = new List<KeyValuePair<ushort, bool>>();
        foreach (string part in parts) { if (part.Trim().Length == 0) continue; bool ext; ushort vk = Vk(part, out ext); keys.Add(new KeyValuePair<ushort, bool>(vk, ext)); }
        var inputs = new List<INPUT>();
        foreach (var k in keys) inputs.Add(KeyInput(k.Key, k.Value, false));
        for (int i = keys.Count - 1; i >= 0; i--) inputs.Add(KeyInput(keys[i].Key, keys[i].Value, true));
        if (SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT))) != inputs.Count) throw new Exception("Windows 拒绝了按键输入。");
    }
}
'@
[CocoNative]::Init()

function Invoke-Request($request) {
    switch ([string]$request.action) {
        # The leading comma keeps one-item and empty arrays from being unrolled by the pipeline.
        'windows' { return ,@([CocoNative]::Windows([int]$request.exclude)) }
        'attach' { [CocoNative]::Attach([long]$request.hwnd, [long]$request.owner); return $true }
        'place' { return ,@(foreach ($item in @($request.items)) { [CocoNative]::Place([long]$item.hwnd, [int]$item.x, [int]$item.y, [int]$item.w, [int]$item.h, [bool]$item.show) }) }
        'release' { [CocoNative]::Release([long]$request.hwnd); return $true }
        'close' { [CocoNative]::Close([long]$request.hwnd); return $true }
        'focus' { return [CocoNative]::Focus([long]$request.hwnd) }
        'capture' { return [CocoNative]::Capture([long]$request.hwnd, [int]$request.max, [string]$request.path) }
        'click' { [CocoNative]::Click([long]$request.hwnd, [double]$request.x, [double]$request.y, [string]$request.button, [int]$request.count); return $true }
        'move' { [CocoNative]::Move([long]$request.hwnd, [double]$request.x, [double]$request.y); return $true }
        'drag' { [CocoNative]::Drag([long]$request.hwnd, [double]$request.x, [double]$request.y, [double]$request.toX, [double]$request.toY); return $true }
        'scroll' { [CocoNative]::Scroll([long]$request.hwnd, [double]$request.x, [double]$request.y, [int]$request.amount); return $true }
        'type' { [CocoNative]::Type([long]$request.hwnd, [string]$request.text); return $true }
        'key' { [CocoNative]::Key([long]$request.hwnd, [string]$request.key); return $true }
        'launch' {
            if ($request.android) { [CocoNative]::Launch([string]$request.client, '/launch wsa://' + [string]$request.app) }
            else { [CocoNative]::Launch((Join-Path $env:WINDIR 'explorer.exe'), 'shell:AppsFolder\' + [string]$request.app) }
            return $true
        }
        'apps' {
            # WSA registers each Android app as a Start menu shortcut to WsaClient.exe /launch wsa://<package>.
            $android = @{}; $client = ''
            $shell = New-Object -ComObject WScript.Shell
            foreach ($dir in @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'))) {
                if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
                foreach ($file in Get-ChildItem -LiteralPath $dir -Recurse -Filter *.lnk -ErrorAction SilentlyContinue) {
                    try {
                        $link = $shell.CreateShortcut($file.FullName)
                        if ($link.TargetPath -match 'WsaClient\.exe$' -and $link.Arguments -match 'wsa://([^\s"]+)') { $android[$Matches[1]] = $true; $client = $link.TargetPath }
                    } catch {}
                }
            }
            return @{ client = $client; apps = @(Get-StartApps | ForEach-Object { @{ name = $_.Name; id = $_.AppID; android = [bool]$android[$_.AppID] } }) }
        }
        default { throw "未知操作：$($request.action)" }
    }
}

[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
    $id = $null
    try {
        $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
        $id = $request.id
        $response = @{ id = $id; ok = $true; data = (Invoke-Request $request) }
    } catch {
        $response = @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
    $json = ConvertTo-Json -InputObject $response -Compress -Depth 6
    [Console]::Out.WriteLine([Convert]::ToBase64String($utf8.GetBytes($json)))
    [Console]::Out.Flush()
}
