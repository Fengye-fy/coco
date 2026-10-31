$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class InputFixture : Form {
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    readonly Stopwatch press = new Stopwatch();
    readonly string log = Environment.GetEnvironmentVariable("COCO_INPUT_FIXTURE_LOG");
    public InputFixture(string name, int x, int y, int w, int h) {
        Text = name; StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.None; Bounds = new Rectangle(x, y, w, h);
        MinimumSize = new Size(w, h); BackColor = Color.Beige; KeyPreview = true;
    }
    public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
    protected override void WndProc(ref Message m) {
        // Reproduce an inactive app consuming its activation click.
        if (m.Msg == 0x21) { m.Result = new IntPtr(2); return; }
        base.WndProc(ref m);
    }
    protected override void OnMouseDown(MouseEventArgs e) { press.Restart(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) {
        // Model a remote UI which needs a press to survive at least one frame.
        File.AppendAllText(log, "mouse|" + Text + "|" + e.X + "|" + e.Y + "|" + press.ElapsedMilliseconds + "\n");
        press.Reset(); base.OnMouseUp(e);
    }
    protected override void OnKeyPress(KeyPressEventArgs e) {
        File.AppendAllText(log, "key|" + Text + "|" + e.KeyChar + "\n"); base.OnKeyPress(e);
    }
}
'@
[InputFixture]::Init()
$owner = New-Object InputFixture('input-owner', 40, 80, 1100, 850)
$target = New-Object InputFixture('input-target', 120, 160, 900, 700)
$other = New-Object InputFixture('input-other', 1140, 160, 160, 160)
$owner.Show()
$target.Show()
$other.Show()
[Console]::Out.WriteLine((@{ owner = $owner.Handle.ToInt64().ToString(); target = $target.Handle.ToInt64().ToString(); other = $other.Handle.ToInt64().ToString() } | ConvertTo-Json -Compress))
[Console]::Out.Flush()
[System.Windows.Forms.Application]::Run($owner)
