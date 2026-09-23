$ErrorActionPreference = 'Stop'

function Get-Field {
  param([object]$Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function ConvertTo-ExcelRangeValues {
  param([object]$Values, [object]$Range)
  if ($null -eq $Values) { return $null }
  if (-not ($Values -is [System.Array])) { return $Values }

  $rowCount = [int]$Range.Rows.Count
  $columnCount = [int]$Range.Columns.Count
  $top = @($Values)
  if ($top.Count -eq 0) { throw 'values must not be empty' }

  $nested = $top[0] -is [System.Array]
  if ($nested) {
    if ($top.Count -ne $rowCount) { throw "values row count $($top.Count) does not match target range row count $rowCount" }
    $matrix = New-Object 'object[,]' $rowCount, $columnCount
    for ($rowIndex = 0; $rowIndex -lt $rowCount; $rowIndex += 1) {
      $cells = @($top[$rowIndex])
      if ($cells.Count -ne $columnCount) { throw "values column count $($cells.Count) does not match target range column count $columnCount at row $($rowIndex + 1)" }
      for ($columnIndex = 0; $columnIndex -lt $columnCount; $columnIndex += 1) {
        $matrix[$rowIndex, $columnIndex] = $cells[$columnIndex]
      }
    }
    return ,$matrix
  }

  if ($rowCount -eq 1 -and $top.Count -eq $columnCount) {
    $matrix = New-Object 'object[,]' 1, $columnCount
    for ($columnIndex = 0; $columnIndex -lt $columnCount; $columnIndex += 1) { $matrix[0, $columnIndex] = $top[$columnIndex] }
    return ,$matrix
  }
  if ($columnCount -eq 1 -and $top.Count -eq $rowCount) {
    $matrix = New-Object 'object[,]' $rowCount, 1
    for ($rowIndex = 0; $rowIndex -lt $rowCount; $rowIndex += 1) { $matrix[$rowIndex, 0] = $top[$rowIndex] }
    return ,$matrix
  }
  if ($top.Count -eq 1) { return $top[0] }
  throw ("values shape does not match target range {0}x{1}" -f $rowCount, $columnCount)
}

function Success {
  param([object]$Value)
  return [ordered]@{ ok = $true; value = $Value }
}

function Failure {
  param([string]$Code, [string]$Message, [bool]$Recoverable = $false)
  return [ordered]@{ ok = $false; error = [ordered]@{ code = $Code; message = $Message; recoverable = $Recoverable } }
}

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class LnwjudNative
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputUnion Union; }
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyboardInput Keyboard; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int Dx; public int Dy; public uint MouseData; public uint Flags; public uint Time; public IntPtr ExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput { public ushort VirtualKey; public ushort ScanCode; public uint Flags; public uint Time; public IntPtr ExtraInfo; }

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hWnd, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

    public static bool EnsurePhysicalPixelCoordinates()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return true; } catch { }
        try { return SetProcessDPIAware(); } catch { return false; }
    }

    public static List<Dictionary<string, object>> Windows()
    {
        var result = new List<Dictionary<string, object>>();
        EnumWindows((hWnd, extra) =>
        {
            if (!IsWindow(hWnd)) return true;
            // Skip owned popups; keep every top-level HWND (visible, minimized, or cloaked).
            if (GetWindow(hWnd, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            var titleBuilder = new StringBuilder(512);
            GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
            var title = titleBuilder.ToString();
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            var processName = "";
            var processPath = "";
            try
            {
                var process = Process.GetProcessById((int)processId);
                processName = process.ProcessName;
                try { if (process.MainModule != null) processPath = process.MainModule.FileName; } catch { }
                process.Dispose();
            }
            catch { }
            // Drop empty shell noise (no title and no process name), keep everything else.
            if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(processName)) return true;
            var bounds = new Rect();
            GetWindowRect(hWnd, out bounds);
            var boundsValue = new Dictionary<string, object>();
            boundsValue.Add("x", bounds.Left);
            boundsValue.Add("y", bounds.Top);
            boundsValue.Add("width", bounds.Right - bounds.Left);
            boundsValue.Add("height", bounds.Bottom - bounds.Top);
            var record = new Dictionary<string, object>();
            record.Add("hwnd", hWnd.ToInt64());
            record.Add("title", string.IsNullOrWhiteSpace(title) ? processName : title);
            record.Add("process_id", (long)processId);
            record.Add("process_name", processName);
            record.Add("process_path", processPath);
            record.Add("visible", IsWindowVisible(hWnd));
            record.Add("minimized", IsIconic(hWnd));
            record.Add("bounds", boundsValue);
            result.Add(record);
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static void Key(ushort virtualKey, bool keyUp)
    {
        var input = new Input { Type = 1, Union = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = virtualKey, Flags = keyUp ? 2u : 0u } } };
        SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input)));
    }

    public static void Unicode(ushort code, bool keyUp)
    {
        var input = new Input { Type = 1, Union = new InputUnion { Keyboard = new KeyboardInput { ScanCode = code, Flags = (keyUp ? 2u : 0u) | 4u } } };
        SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input)));
    }

    public static void MouseButton(uint flags) { mouse_event(flags, 0, 0, 0, UIntPtr.Zero); }
    public static void MouseWheel(int delta, bool horizontal) { mouse_event(horizontal ? 0x1000u : 0x800u, 0, 0, delta, UIntPtr.Zero); }
}
'@

try { Add-Type -TypeDefinition $nativeSource -ErrorAction Stop | Out-Null } catch { }
$physicalPixelCoordinates = [LnwjudNative]::EnsurePhysicalPixelCoordinates()

function Resolve-Window {
  param([object]$Parameters, [switch]$PreferCapturable, [object]$WindowIndexOverride = $null)

  $windows = @([LnwjudNative]::Windows())
  $windowIndex = if ($null -ne $WindowIndexOverride) { $WindowIndexOverride } elseif ($null -ne $Parameters) { Get-Field $Parameters 'window_index' } else { $null }
  $hasWindowIndex = $windowIndex -is [int] -or $windowIndex -is [long]

  if ($null -ne $Parameters) {
    $handle = Get-Field $Parameters 'hwnd'
    if ($null -ne $handle) {
      return $windows | Where-Object { [int64]$_.hwnd -eq [int64]$handle } | Select-Object -First 1
    }
  }

  $title = if ($null -ne $Parameters) { Get-Field $Parameters 'title' } else { $null }
  $name = if ($null -ne $Parameters) { Get-Field $Parameters 'name' } else { $null }
  $processName = if ($null -ne $Parameters) { Get-Field $Parameters 'process_name' } else { $null }

  $hasTitle = $title -is [string] -and -not [string]::IsNullOrWhiteSpace($title)
  $hasName = $name -is [string] -and -not [string]::IsNullOrWhiteSpace($name)
  $hasProcessName = $processName -is [string] -and -not [string]::IsNullOrWhiteSpace($processName)
  if (-not $hasTitle -and -not $hasName -and -not $hasProcessName -and -not $hasWindowIndex) { return $null }

  $matches = @($windows)
  if ($hasTitle) { $matches = @($matches | Where-Object { $_.title -like "*$title*" }) }
  if ($hasProcessName) { $matches = @($matches | Where-Object { $_.process_name -ieq $processName }) }
  if ($hasName) {
    $matches = @($matches | Where-Object { $_.process_name -ieq $name -or $_.title -like "*$name*" })
  }
  if ($matches.Count -eq 0) { return $null }

  if ($PreferCapturable -and (-not $hasWindowIndex -or $hasTitle -or $hasName -or $hasProcessName)) {
    $capturable = @($matches | Where-Object {
      [bool]$_.visible -and -not [bool]$_.minimized -and [int]$_.bounds.width -gt 0 -and [int]$_.bounds.height -gt 0
    })
    if ($capturable.Count -gt 0) { $matches = $capturable }
  }

  if ($hasName) {
    $matches = @($matches | Sort-Object @{ Expression = { if ($_.process_name -ieq $name) { 0 } else { 1 } }; Ascending = $true }, @{ Expression = { [int64]$_.bounds.width * [int64]$_.bounds.height }; Descending = $true })
  } elseif ($PreferCapturable) {
    $matches = @($matches | Sort-Object @{ Expression = { [int64]$_.bounds.width * [int64]$_.bounds.height }; Descending = $true })
  }

  if ($hasWindowIndex) {
    $index = [int]$windowIndex
    if ($index -lt 0 -or $index -ge $matches.Count) { return $null }
    return $matches[$index]
  }

  return $matches | Select-Object -First 1
}

function Invoke-WindowAction {
  param([string]$Operation, [object]$Parameters)
  switch ($Operation) {
    'list' { return [ordered]@{ windows = @([LnwjudNative]::Windows()) } }
    'get_active' {
      $hwnd = [LnwjudNative]::GetForegroundWindow()
      $window = [LnwjudNative]::Windows() | Where-Object { [int64]$_.hwnd -eq $hwnd.ToInt64() } | Select-Object -First 1
      return [ordered]@{ window = $window }
    }
    'get_bounds' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; return $window.bounds }
    'get_display' {
      Add-Type -AssemblyName System.Windows.Forms
      $window = Resolve-Window $Parameters
      if ($null -eq $window) { throw 'Window not found' }
      $screen = [System.Windows.Forms.Screen]::FromHandle([IntPtr]([int64]$window.hwnd))
      return [ordered]@{ display_id = $screen.DeviceName; primary = $screen.Primary; bounds = [ordered]@{ x = $screen.Bounds.X; y = $screen.Bounds.Y; width = $screen.Bounds.Width; height = $screen.Bounds.Height } }
    }
    'activate' {
      $window = Resolve-Window $Parameters
      if ($null -eq $window) { throw 'Window not found' }
      $hwnd = [IntPtr]([int64]$window.hwnd)
      if ([bool]$window.minimized) { [void][LnwjudNative]::ShowWindow($hwnd, 9); Start-Sleep -Milliseconds 40 }
      $requested = [LnwjudNative]::SetForegroundWindow($hwnd)
      Start-Sleep -Milliseconds 40
      $activated = ([LnwjudNative]::GetForegroundWindow().ToInt64() -eq $hwnd.ToInt64())
      if (-not $activated -and $requested) {
        Start-Sleep -Milliseconds 40
        [void][LnwjudNative]::SetForegroundWindow($hwnd)
        $activated = ([LnwjudNative]::GetForegroundWindow().ToInt64() -eq $hwnd.ToInt64())
      }
      $reason = if ($activated) { $null } else { 'Windows did not grant foreground activation' }
      return [ordered]@{ activated = $activated; requested = [bool]$requested; window = $window; reason = $reason }
    }
    'close' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; [void][LnwjudNative]::PostMessage([IntPtr]([int64]$window.hwnd), 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); return [ordered]@{ closed = $true; hwnd = $window.hwnd } }
    'minimize' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; [void][LnwjudNative]::ShowWindow([IntPtr]([int64]$window.hwnd), 6); return [ordered]@{ minimized = $true; hwnd = $window.hwnd } }
    'maximize' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; [void][LnwjudNative]::ShowWindow([IntPtr]([int64]$window.hwnd), 3); return [ordered]@{ maximized = $true; hwnd = $window.hwnd } }
    'restore' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; [void][LnwjudNative]::ShowWindow([IntPtr]([int64]$window.hwnd), 9); return [ordered]@{ restored = $true; hwnd = $window.hwnd } }
    'move' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; [void][LnwjudNative]::MoveWindow([IntPtr]([int64]$window.hwnd), [int](Get-Field $Parameters 'x'), [int](Get-Field $Parameters 'y'), [int]$window.bounds.width, [int]$window.bounds.height, $true); return [ordered]@{ moved = $true; hwnd = $window.hwnd } }
    'resize' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; [void][LnwjudNative]::MoveWindow([IntPtr]([int64]$window.hwnd), [int]$window.bounds.x, [int]$window.bounds.y, [int](Get-Field $Parameters 'width'), [int](Get-Field $Parameters 'height'), $true); return [ordered]@{ resized = $true; hwnd = $window.hwnd } }
    'set_window_frame' { $window = Resolve-Window $Parameters; if ($null -eq $window) { throw 'Window not found' }; [void][LnwjudNative]::MoveWindow([IntPtr]([int64]$window.hwnd), [int](Get-Field $Parameters 'x'), [int](Get-Field $Parameters 'y'), [int](Get-Field $Parameters 'width'), [int](Get-Field $Parameters 'height'), $true); return [ordered]@{ framed = $true; hwnd = $window.hwnd } }
    default { throw "Unsupported window operation: $Operation" }
  }
}

function Load-UiAutomation {
  try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop; Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop; return $true } catch { return $false }
}

function Get-FiniteUiBounds {
  param([object]$Rect)
  if ($null -eq $Rect) { return $null }
  $x = [double]$Rect.X
  $y = [double]$Rect.Y
  $width = [double]$Rect.Width
  $height = [double]$Rect.Height
  foreach ($value in @($x, $y, $width, $height)) {
    if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return $null }
  }
  return [ordered]@{ x = $x; y = $y; width = $width; height = $height }
}

function Get-ElementRecord {
  param([object]$Element)
  $current = $Element.Current
  $rect = $current.BoundingRectangle
  $bounds = Get-FiniteUiBounds $rect
  $controlType = ''
  if ($null -ne $current.ControlType) { $controlType = [string]$current.ControlType.ProgrammaticName }
  return [ordered]@{ name = [string]$current.Name; automation_id = [string]$current.AutomationId; control_type = $controlType; class_name = [string]$current.ClassName; enabled = [bool]$current.IsEnabled; offscreen = [bool]$current.IsOffscreen; bounds = $bounds }
}

function Invoke-UiPointerClick {
  param([object]$Element)
  $current = $Element.Current
  if ([bool]$current.IsOffscreen) { throw 'UI element is off-screen' }
  $bounds = Get-FiniteUiBounds $current.BoundingRectangle
  if ($null -eq $bounds -or $bounds.width -le 0 -or $bounds.height -le 0) { throw 'UI element does not have clickable bounds' }
  $x = [int][Math]::Round($bounds.x + ($bounds.width / 2.0))
  $y = [int][Math]::Round($bounds.y + ($bounds.height / 2.0))
  if (-not [LnwjudNative]::SetCursorPos($x, $y)) { throw 'Pointer could not be moved to the UI element' }
  [LnwjudNative]::MouseButton(0x2)
  [LnwjudNative]::MouseButton(0x4)
  return [ordered]@{ x = $x; y = $y }
}

function Test-UiWindowSelector {
  param([object]$Parameters)
  if ($null -eq $Parameters) { return $false }
  foreach ($name in @('hwnd', 'title', 'name', 'process_name', 'window_index')) {
    $value = Get-Field $Parameters $name
    if ($null -ne $value) {
      if ($value -isnot [string] -or $value.Length -gt 0) { return $true }
    }
  }
  return $false
}

function Get-UiRoot {
  param([object]$Parameters)
  if (-not (Test-UiWindowSelector $Parameters)) {
    return [System.Windows.Automation.AutomationElement]::RootElement
  }
  $window = Resolve-Window $Parameters -PreferCapturable
  if ($null -eq $window) { throw 'Window not found' }
  return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([int64]$window.hwnd))
}

function Add-UiTree {
  param([object]$Element, [System.Collections.Generic.List[object]]$Items, [int]$Depth, [int]$MaxDepth, [int]$MaxItems)
  if ($null -eq $Element -or $Items.Count -ge $MaxItems) { return }
  try {
    $record = Get-ElementRecord $Element
    [void]$Items.Add([ordered]@{ depth = $Depth; element = $record })
  } catch {
    # UI Automation trees are live. A control can disappear between sibling
    # enumeration and property reads; skip only that stale element instead of
    # failing the entire observation.
  }
  if ($Depth -ge $MaxDepth -or $Items.Count -ge $MaxItems) { return }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  try { $child = $walker.GetFirstChild($Element) } catch { return }
  while ($null -ne $child -and $Items.Count -lt $MaxItems) {
    $currentChild = $child
    try { $child = $walker.GetNextSibling($currentChild) } catch { $child = $null }
    Add-UiTree $currentChild $Items ($Depth + 1) $MaxDepth $MaxItems
  }
}

function Find-UiElement {
  param([object]$Root, [object]$Parameters)
  $name = Get-Field $Parameters 'name'
  $automationId = Get-Field $Parameters 'automation_id'
  if ($name -is [string] -and $name.Length -gt 0) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
    $found = $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -ne $found) { return $found }
  }
  if ($automationId -is [string] -and $automationId.Length -gt 0) {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $automationId)
    $found = $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -ne $found) { return $found }
  }
  return $null
}

function Invoke-AccessibilityAction {
  param([string]$Action, [object]$Parameters)
  if ($Action -eq 'status') { return [ordered]@{ available = (Load-UiAutomation); backend = 'Microsoft UI Automation' } }
  if ($Action -eq 'list_windows') { return [ordered]@{ windows = @([LnwjudNative]::Windows()) } }
  if ($Action -eq 'launch_app') {
    $executable = Get-Field $Parameters 'executable'
    if ($executable -isnot [string] -or $executable.Length -eq 0) { throw 'Executable is required' }
    $arguments = Get-Field $Parameters 'arguments'
    if ($null -eq $arguments) { [void](Start-Process -FilePath $executable) } else { [void](Start-Process -FilePath $executable -ArgumentList @($arguments)) }
    return [ordered]@{ started = $true; executable = $executable }
  }
  if ($Action -eq 'activate_app') { return Invoke-WindowAction 'activate' $Parameters }
  if ($Action -eq 'set_window_frame') { return Invoke-WindowAction 'set_window_frame' $Parameters }
  if ($Action -in @('close_window', 'minimize_window', 'maximize_window', 'restore_window')) { return Invoke-WindowAction ($Action -replace '_window', '') $Parameters }
  if (-not (Load-UiAutomation)) { throw 'Microsoft UI Automation is unavailable' }
  $root = Get-UiRoot $Parameters
  if ($Action -in @('observe', 'observe_summary', 'observe_changes', 'inspect_elements')) {
    $items = New-Object 'System.Collections.Generic.List[object]'
    $maxDepthValue = Get-Field $Parameters 'max_depth'
    $maxDepth = if ($null -eq $maxDepthValue) { 4 } else { [Math]::Max(0, [int]$maxDepthValue) }
    $maxItemsValue = Get-Field $Parameters 'max_items'
    $maxItems = if ($null -eq $maxItemsValue -or [int]$maxItemsValue -le 0) { 200 } else { [int]$maxItemsValue }
    Add-UiTree $root $items 0 $maxDepth $maxItems
    # Windows PowerShell 5.1 throws "Argument types do not match" when the
    # array-subexpression operator wraps List[object]. ToArray() is stable on
    # both Windows 10 and Windows 11 and keeps the JSON shape deterministic.
    return [ordered]@{ elements = $items.ToArray(); count = $items.Count }
  }
  $element = Find-UiElement $root $Parameters
  if ($null -eq $element) { throw 'UI element was not found' }
  switch ($Action) {
    'find_element' { return [ordered]@{ element = Get-ElementRecord $element } }
    'focus' { [void]$element.SetFocus(); return [ordered]@{ focused = $true; element = Get-ElementRecord $element } }
    'click' {
      $method = 'invoke_pattern'
      try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
      } catch {
        [void](Invoke-UiPointerClick $element)
        $method = 'pointer_fallback'
      }
      return [ordered]@{ clicked = $true; method = $method; element = Get-ElementRecord $element }
    }
    'read_value' { try { $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); return [ordered]@{ value = $pattern.Current.Value } } catch { return [ordered]@{ value = $element.Current.Name } } }
    'set_value' { $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $pattern.SetValue([string](Get-Field $Parameters 'value')); return [ordered]@{ set = $true; value = [string](Get-Field $Parameters 'value') } }
    'select_item' {
      $method = 'selection_item_pattern'
      try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $pattern.Select()
      } catch {
        try {
          $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $pattern.Invoke()
          $method = 'invoke_pattern'
        } catch {
          [void](Invoke-UiPointerClick $element)
          $method = 'pointer_fallback'
        }
      }
      return [ordered]@{ selected = $true; method = $method; element = Get-ElementRecord $element }
    }
    'menu_select' {
      $method = 'invoke_pattern'
      try {
        $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
      } catch {
        try {
          $pattern = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
          $pattern.Select()
          $method = 'selection_item_pattern'
        } catch {
          [void](Invoke-UiPointerClick $element)
          $method = 'pointer_fallback'
        }
      }
      return [ordered]@{ selected = $true; method = $method; element = Get-ElementRecord $element }
    }
    default { throw "Unsupported accessibility action: $Action" }
  }
}

function Get-VirtualKey {
  param([object]$Key)
  if ($Key -is [int] -or $Key -is [long]) { return [uint16]$Key }
  $value = ([string]$Key).ToUpperInvariant()
  $named = @{ ENTER = 0x0D; ESC = 0x1B; ESCAPE = 0x1B; TAB = 0x09; BACKSPACE = 0x08; DELETE = 0x2E; HOME = 0x24; END = 0x23; LEFT = 0x25; UP = 0x26; RIGHT = 0x27; DOWN = 0x28; SHIFT = 0x10; CTRL = 0x11; CONTROL = 0x11; ALT = 0x12; WIN = 0x5B; SPACE = 0x20; F1 = 0x70; F2 = 0x71; F3 = 0x72; F4 = 0x73; F5 = 0x74; F6 = 0x75; F7 = 0x76; F8 = 0x77; F9 = 0x78; F10 = 0x79; F11 = 0x7A; F12 = 0x7B }
  if ($named.ContainsKey($value)) { return [uint16]$named[$value] }
  if ($value.Length -eq 1) { return [uint16][char]$value[0] }
  throw 'Unsupported key'
}

function Invoke-KeyPress {
  param([object]$Key)
  $code = Get-VirtualKey $Key
  [LnwjudNative]::Key($code, $false); [LnwjudNative]::Key($code, $true)
}

function Invoke-InputAction {
  param([string]$Operation, [object]$Parameters)
  switch ($Operation) {
    'type_text' { foreach ($character in ([string](Get-Field $Parameters 'text')).ToCharArray()) { [LnwjudNative]::Unicode([uint16][char]$character, $false); [LnwjudNative]::Unicode([uint16][char]$character, $true) }; return [ordered]@{ typed = $true } }
    'paste_text' { foreach ($character in ([string](Get-Field $Parameters 'text')).ToCharArray()) { [LnwjudNative]::Unicode([uint16][char]$character, $false); [LnwjudNative]::Unicode([uint16][char]$character, $true) }; return [ordered]@{ pasted = $true } }
    'press_key' { Invoke-KeyPress (Get-Field $Parameters 'key'); return [ordered]@{ pressed = $true } }
    'hotkey' { $keys = @(Get-Field $Parameters 'modifiers'); $pressedKeys = @(); try { foreach ($key in $keys) { $virtualKey = Get-VirtualKey $key; [LnwjudNative]::Key($virtualKey, $false); $pressedKeys += [uint16]$virtualKey }; Invoke-KeyPress (Get-Field $Parameters 'key') } finally { $releaseKeys = @($pressedKeys); [array]::Reverse($releaseKeys); foreach ($virtualKey in $releaseKeys) { [LnwjudNative]::Key([uint16]$virtualKey, $true) } }; return [ordered]@{ pressed = $true } }
    'key_down' { [LnwjudNative]::Key((Get-VirtualKey (Get-Field $Parameters 'key')), $false); return [ordered]@{ down = $true } }
    'key_up' { [LnwjudNative]::Key((Get-VirtualKey (Get-Field $Parameters 'key')), $true); return [ordered]@{ up = $true } }
    'mouse_move' { [void][LnwjudNative]::SetCursorPos([int](Get-Field $Parameters 'x'), [int](Get-Field $Parameters 'y')); return [ordered]@{ moved = $true } }
    'click' { [void][LnwjudNative]::SetCursorPos([int](Get-Field $Parameters 'x'), [int](Get-Field $Parameters 'y')); [LnwjudNative]::MouseButton(0x2); [LnwjudNative]::MouseButton(0x4); return [ordered]@{ clicked = $true } }
    'double_click' { [void][LnwjudNative]::SetCursorPos([int](Get-Field $Parameters 'x'), [int](Get-Field $Parameters 'y')); 1..2 | ForEach-Object { [LnwjudNative]::MouseButton(0x2); [LnwjudNative]::MouseButton(0x4); if ($_ -eq 1) { Start-Sleep -Milliseconds 40 } }; return [ordered]@{ clicked = $true; count = 2 } }
    'right_click' { [void][LnwjudNative]::SetCursorPos([int](Get-Field $Parameters 'x'), [int](Get-Field $Parameters 'y')); [LnwjudNative]::MouseButton(0x8); [LnwjudNative]::MouseButton(0x10); return [ordered]@{ clicked = $true; button = 'right' } }
    'button_down' { [LnwjudNative]::MouseButton(0x2); return [ordered]@{ down = $true } }
    'button_up' { [LnwjudNative]::MouseButton(0x4); return [ordered]@{ up = $true } }
    'scroll' { [LnwjudNative]::MouseWheel([int](Get-Field $Parameters 'delta_y'), $false); return [ordered]@{ scrolled = $true } }
    'drag' { $from = Get-Field $Parameters 'from'; $to = Get-Field $Parameters 'to'; [void][LnwjudNative]::SetCursorPos([int](Get-Field $from 'x'), [int](Get-Field $from 'y')); [LnwjudNative]::MouseButton(0x2); [void][LnwjudNative]::SetCursorPos([int](Get-Field $to 'x'), [int](Get-Field $to 'y')); [LnwjudNative]::MouseButton(0x4); return [ordered]@{ dragged = $true } }
    'release_all' { foreach ($key in @(0x10, 0x11, 0x12, 0x5B)) { [LnwjudNative]::Key([uint16]$key, $true) }; [LnwjudNative]::MouseButton(0x4); [LnwjudNative]::MouseButton(0x10); return [ordered]@{ released = $true } }
    'sequence' { $steps = @(Get-Field $Parameters 'steps'); if ($steps.Count -lt 1 -or $steps.Count -gt 100) { throw 'Input sequence requires 1 to 100 steps' }; $results = foreach ($step in $steps) { $stepParams = Get-Field $step 'parameters'; if ($null -eq $stepParams) { $stepParams = $step }; Invoke-InputAction ([string](Get-Field $step 'operation')) $stepParams }; return [ordered]@{ steps = @($results) } }
    default { throw "Unsupported input operation: $Operation" }
  }
}

function Invoke-VisionAction {
  param([string]$Action, [object]$Parameters)
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  if ($Action -eq 'ocr') { return [ordered]@{ available = $false; reason = 'A local Windows OCR runtime is not installed; use accessibility for semantic text.' } }
  if ($Action -eq 'annotate') {
    $encoded = Get-Field $Parameters 'image_base64'
    if ($encoded -isnot [string] -or $encoded.Length -eq 0) { throw 'image_base64 is required for annotation' }
    $bytes = [Convert]::FromBase64String($encoded)
    if ($bytes.Length -gt 16MB) { throw 'Annotation image is too large' }
    $inputStream = New-Object System.IO.MemoryStream(, $bytes)
    $bitmap = [System.Drawing.Bitmap]::FromStream($inputStream)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 3)
    $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Yellow)
    $labelBackground = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(190, 0, 0, 0))
    $font = New-Object System.Drawing.Font -ArgumentList @('Arial', 12, [System.Drawing.FontStyle]::Bold)
    foreach ($mark in @(Get-Field $Parameters 'marks')) {
      $bounds = Get-Field $mark 'bounds'
      if ($null -eq $bounds) { continue }
      $markId = [string](Get-Field $mark 'mark_id')
      $markX = [int](Get-Field $bounds 'x'); $markY = [int](Get-Field $bounds 'y')
      $markWidth = [int](Get-Field $bounds 'width'); $markHeight = [int](Get-Field $bounds 'height')
      if ($markWidth -lt 1 -or $markHeight -lt 1) { continue }
      $graphics.DrawRectangle($pen, $markX, $markY, $markWidth, $markHeight)
      $labelSize = $graphics.MeasureString($markId, $font)
      $labelRect = New-Object System.Drawing.RectangleF($markX, $markY, [Math]::Max($labelSize.Width + 8, 24), [Math]::Max($labelSize.Height + 4, 20))
      $graphics.FillRectangle($labelBackground, $labelRect)
      $graphics.DrawString($markId, $font, $labelBrush, $markX + 4, $markY + 2)
    }
    $outputStream = New-Object System.IO.MemoryStream
    $bitmap.Save($outputStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $outputBytes = $outputStream.ToArray()
    $outputWidth = [int]$bitmap.Width; $outputHeight = [int]$bitmap.Height
    $graphics.Dispose(); $pen.Dispose(); $labelBrush.Dispose(); $labelBackground.Dispose(); $font.Dispose(); $bitmap.Dispose(); $inputStream.Dispose(); $outputStream.Dispose()
    if ($outputBytes.Length -gt 16MB) { throw 'Annotated image is too large' }
    return [ordered]@{ format = 'png'; mime_type = 'image/png'; data_base64 = [Convert]::ToBase64String($outputBytes); width = $outputWidth; height = $outputHeight; annotated = $true; backend = 'Win32/System.Drawing Set-of-Marks overlay' }
  }
  $x = 0; $y = 0; $width = 0; $height = 0; $source = $Action; $scaleX = 1.0; $scaleY = 1.0
  if ($Action -eq 'capture_display') {
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $displayId = Get-Field $Parameters 'display_id'
    $screen = if ($null -eq $displayId) { [System.Windows.Forms.Screen]::PrimaryScreen } else { $screens | Where-Object { $_.DeviceName -eq $displayId -or $_.DeviceName -like "*$displayId*" } | Select-Object -First 1 }
    if ($null -eq $screen) { throw 'Display not found' }
    $x = $screen.Bounds.X; $y = $screen.Bounds.Y; $width = $screen.Bounds.Width; $height = $screen.Bounds.Height
  } elseif ($Action -eq 'capture_region') {
    $region = Get-Field $Parameters 'region'; if ($null -eq $region) { throw 'Region is required' }
    $x = [int](Get-Field $region 'x'); $y = [int](Get-Field $region 'y'); $width = [int](Get-Field $region 'width'); $height = [int](Get-Field $region 'height')
  } elseif ($Action -eq 'capture_window') {
    $windowIndex = Get-Field $Parameters 'window_index'
    $window = Resolve-Window (Get-Field $Parameters 'app') -PreferCapturable -WindowIndexOverride $windowIndex
    if ($null -eq $window) { throw 'Window not found' }
    $captureHwnd = [IntPtr]([int64]$window.hwnd)
    if ([bool]$window.minimized) { [void][LnwjudNative]::ShowWindow($captureHwnd, 9); Start-Sleep -Milliseconds 80 }
    if (-not [bool]$window.visible) { [void][LnwjudNative]::ShowWindow($captureHwnd, 5); Start-Sleep -Milliseconds 80 }
    $rect = New-Object LnwjudNative+Rect
    if (-not [LnwjudNative]::GetWindowRect($captureHwnd, [ref]$rect)) { throw 'Window bounds could not be read' }
    $x = [int]$rect.Left; $y = [int]$rect.Top; $width = [int]($rect.Right - $rect.Left); $height = [int]($rect.Bottom - $rect.Top)
    $dpi = [LnwjudNative]::GetDpiForWindow($captureHwnd)
    $dpiScale = if ($dpi -gt 0) { [double]$dpi / 96.0 } else { 1.0 }
    if (-not $physicalPixelCoordinates) { $scaleX = $dpiScale; $scaleY = $dpiScale }
  } else { throw "Unsupported vision action: $Action" }
  if ($width -lt 1 -or $height -lt 1 -or $width -gt 10000 -or $height -gt 10000) { throw 'Capture bounds are invalid' }
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $usedPrintWindow = $false
  if ($Action -eq 'capture_window') {
    $hdc = $graphics.GetHdc()
    try { $usedPrintWindow = [LnwjudNative]::PrintWindow($captureHwnd, $hdc, 2) }
    finally { $graphics.ReleaseHdc($hdc) }
  }
  if (-not $usedPrintWindow) { $graphics.CopyFromScreen($x, $y, 0, 0, $bitmap.Size) }
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose()
  if ($bytes.Length -gt 8MB) { throw 'Capture is too large' }

  $verifyStream = [System.IO.MemoryStream]::new($bytes, $false)
  $verifyImage = [System.Drawing.Image]::FromStream($verifyStream, $true, $true)
  if ([int]$verifyImage.Width -ne $width -or [int]$verifyImage.Height -ne $height) {
    $verifyImage.Dispose(); $verifyStream.Dispose()
    throw 'Capture image validation failed'
  }
  $verifyImage.Dispose(); $verifyStream.Dispose()

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $shaBytes = $sha.ComputeHash($bytes)
  $sha.Dispose()
  $sha256 = -join ($shaBytes | ForEach-Object { $_.ToString('x2') })

  $backend = if ($usedPrintWindow) { 'Win32 PrintWindow/System.Drawing' } else { 'Win32/System.Drawing screen capture' }
  $captureSpace = if ($physicalPixelCoordinates) { 'physical_pixels' } else { 'dpi_virtualized_pixels' }
  return [ordered]@{ format = 'png'; mime_type = 'image/png'; data_base64 = [Convert]::ToBase64String($bytes); byte_length = [int]$bytes.Length; sha256 = $sha256; width = $width; height = $height; origin_x = $x; origin_y = $y; scale_x = $scaleX; scale_y = $scaleY; source = $source; backend = $backend; capture_space = $captureSpace }
}

function Invoke-SystemInfoAction {
  param([string]$Operation, [object]$Parameters)
  if ($Operation -eq '' -or $null -eq $Operation) { $Operation = 'all' }
  switch ($Operation) {
    'cpu' { $cpus = @(Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue); return [ordered]@{ model = [string]$cpus[0].Name; cores = [int]$cpus[0].NumberOfCores; logical_processors = [int]$cpus[0].NumberOfLogicalProcessors; load_percent = [int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average } }
    'memory' { $os = Get-CimInstance Win32_OperatingSystem; return [ordered]@{ total_bytes = [int64]$os.TotalVisibleMemorySize * 1KB; free_bytes = [int64]$os.FreePhysicalMemory * 1KB; used_percent = [int][Math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100) } }
    'disks' { return [ordered]@{ drives = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType = 3" | ForEach-Object { [ordered]@{ device = [string]$_.DeviceID; volume = [string]$_.VolumeName; filesystem = [string]$_.FileSystem; total_bytes = [int64]$_.Size; free_bytes = [int64]$_.FreeSpace } }) } }
    'battery' { $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -eq $battery) { return [ordered]@{ present = $false } }; return [ordered]@{ present = $true; percent = [int]$battery.EstimatedChargeRemaining; status = [string]$battery.Status } }
    'uptime' { $os = Get-CimInstance Win32_OperatingSystem; return [ordered]@{ boot_time = [string]$os.LastBootUpTime; uptime_seconds = [int64][Math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds) } }
    'os' { $os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem; return [ordered]@{ name = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; architecture = [string]$os.OSArchitecture; computer_name = [string]$cs.Name; manufacturer = [string]$cs.Manufacturer; model = [string]$cs.Model } }
    'processes' { $topCount = Get-Field $Parameters 'top_count'; if ($null -eq $topCount) { $topCount = 10 }; if ([int]$topCount -lt 1 -or [int]$topCount -gt 50) { throw 'top_count must be from 1 to 50' }; $limit = [int]$topCount; return [ordered]@{ processes = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First $limit | ForEach-Object { $cpu = 0; try { $cpu = [int64][Math]::Round($_.TotalProcessorTime.TotalSeconds) } catch { }; [ordered]@{ name = [string]$_.ProcessName; pid = [int]$_.Id; memory_bytes = [int64]$_.WorkingSet64; cpu_time_seconds = $cpu } }) } }
    'all' {
      return [ordered]@{
        os = (Invoke-SystemInfoAction 'os' $null)
        cpu = (Invoke-SystemInfoAction 'cpu' $null)
        memory = (Invoke-SystemInfoAction 'memory' $null)
        disks = (Invoke-SystemInfoAction 'disks' $null)
        battery = (Invoke-SystemInfoAction 'battery' $null)
        uptime = (Invoke-SystemInfoAction 'uptime' $null)
        top_processes = (Invoke-SystemInfoAction 'processes' $Parameters)
      }
    }
    default { throw "Unsupported system_info operation: $Operation" }
  }
}

function Invoke-NotificationAction {
  param([string]$Action, [object]$Parameters)
  if ($Action -ne 'show') { throw "Unsupported notification action: $Action" }
  $title = [string](Get-Field $Parameters 'title')
  $message = [string](Get-Field $Parameters 'message')
  if ($title.Length -gt 120 -or $message.Length -gt 2000) { throw 'Notification text is too long' }
  $usedToast = $false
  if (Get-Command New-BurntToastNotification -ErrorAction SilentlyContinue) {
    try { New-BurntToastNotification -Text $title, $message -ErrorAction Stop | Out-Null; $usedToast = $true } catch { }
  }
  if (-not $usedToast) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.Visible = $true
    $notify.ShowBalloonTip(5000, $title, $message, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Milliseconds 1200
    $notify.Dispose()
  }
  return [ordered]@{ shown = $true; toast = $usedToast }
}

function Invoke-FileDialogAction {
  param([string]$Action, [object]$Parameters)
  Add-Type -AssemblyName System.Windows.Forms
  $initialDirectory = Get-Field $Parameters 'initial_directory'
  $filter = Get-Field $Parameters 'filter'
  $multiSelect = Get-Field $Parameters 'multi_select'
  if ($Action -eq 'open') {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    if ($null -ne $initialDirectory -and (Test-Path $initialDirectory -PathType Container)) { $dialog.InitialDirectory = $initialDirectory }
    if ($null -ne $filter -and $filter -is [string]) { $dialog.Filter = $filter }
    if ($null -ne $multiSelect) { $dialog.Multiselect = [bool]$multiSelect }
    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return [ordered]@{ canceled = $true; paths = @() } }
    $paths = if ($dialog.Multiselect) { @($dialog.FileNames) } else { @($dialog.FileName) }
    return [ordered]@{ canceled = $false; paths = @($paths) }
  }
  if ($Action -eq 'save') {
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    if ($null -ne $initialDirectory -and (Test-Path $initialDirectory -PathType Container)) { $dialog.InitialDirectory = $initialDirectory }
    if ($null -ne $filter -and $filter -is [string]) { $dialog.Filter = $filter }
    $fileName = Get-Field $Parameters 'file_name'
    if ($null -ne $fileName -and $fileName -is [string] -and $fileName.Length -gt 0) { $dialog.FileName = $fileName }
    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return [ordered]@{ canceled = $true; path = $null } }
    return [ordered]@{ canceled = $false; path = [string]$dialog.FileName }
  }
  throw "Unsupported file_dialog action: $Action"
}

function Invoke-ClipboardAction {
  param([string]$Action, [object]$Parameters)
  Add-Type -AssemblyName System.Windows.Forms
  switch ($Action) {
    'get_text' { return [ordered]@{ text = [string][System.Windows.Forms.Clipboard]::GetText() } }
    'set_text' { $text = Get-Field $Parameters 'text'; if ($null -eq $text -or -not ($text -is [string]) -or $text.Length -gt 1000000) { throw 'Clipboard text must be a string of at most 1000000 characters' }; [System.Windows.Forms.Clipboard]::SetText($text); return [ordered]@{ set = $true; length = $text.Length } }
    'get_image' {
      Add-Type -AssemblyName System.Drawing
      if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { return [ordered]@{ present = $false } }
      $bitmap = [System.Windows.Forms.Clipboard]::GetImage()
      try {
        $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $stream.ToArray()
        if ($bytes.Length -gt 16MB) { throw 'Clipboard image is too large' }
        return [ordered]@{ present = $true; format = 'png'; mime_type = 'image/png'; width = [int]$bitmap.Width; height = [int]$bitmap.Height; data_base64 = [Convert]::ToBase64String($bytes) }
      } finally { $bitmap.Dispose() }
    }
    default { throw "Unsupported clipboard action: $Action" }
  }
}

$audioSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class LnwjudAudio
{
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr callback);

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern int mciGetErrorString(int errorCode, StringBuilder buffer, int bufferSize);

    public static void Mci(string command)
    {
        var buffer = new StringBuilder(512);
        int code = mciSendString(command, buffer, buffer.Capacity, IntPtr.Zero);
        if (code != 0)
        {
            var error = new StringBuilder(256);
            mciGetErrorString(code, error, error.Capacity);
            throw new InvalidOperationException("MCI command failed: " + error.ToString());
        }
    }
}
'@
try { Add-Type -TypeDefinition $audioSource -ErrorAction Stop | Out-Null } catch { }

function Invoke-AudioAction {
  param([string]$Action, [object]$Parameters)
  switch ($Action) {
    'record' {
      $path = [string](Get-Field $Parameters 'output_path')
      if ($path.Length -eq 0) { throw 'output_path is required' }
      $parent = Split-Path -Parent $path
      if (-not (Test-Path $parent -PathType Container)) { throw 'Output directory does not exist' }
      $duration = Get-Field $Parameters 'duration_seconds'; if ($null -eq $duration) { $duration = 10 }
      if ([int]$duration -lt 1 -or [int]$duration -gt 600) { throw 'duration_seconds must be from 1 to 600' }
      [LnwjudAudio]::Mci('open new type waveaudio alias lnwjudrec')
      [LnwjudAudio]::Mci('record lnwjudrec')
      Start-Sleep -Seconds ([int]$duration)
      [LnwjudAudio]::Mci('stop lnwjudrec')
      [LnwjudAudio]::Mci(('save lnwjudrec "' + $path + '"'))
      [LnwjudAudio]::Mci('close lnwjudrec')
      return [ordered]@{ recorded = $true; output_path = $path; duration_seconds = [int]$duration }
    }
    'play' {
      $path = [string](Get-Field $Parameters 'file_path')
      if ($path.Length -eq 0) { throw 'file_path is required' }
      if (-not (Test-Path $path -PathType Leaf)) { throw 'Audio file was not found' }
      $extension = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
      $mciType = 'mpegvideo'
      if ($extension -eq '.wav') { $mciType = 'waveaudio' }
      elseif ($extension -eq '.mid' -or $extension -eq '.midi') { $mciType = 'sequencer' }
      [LnwjudAudio]::Mci(('open "' + $path + '" type ' + $mciType + ' alias lnwjudplay'))
      [LnwjudAudio]::Mci('play lnwjudplay wait')
      [LnwjudAudio]::Mci('close lnwjudplay')
      return [ordered]@{ played = $true; file_path = $path }
    }
    'stop' {
      foreach ($command in @('stop lnwjudrec', 'stop lnwjudplay', 'close lnwjudrec', 'close lnwjudplay')) {
        try { [LnwjudAudio]::Mci($command) } catch { }
      }
      return [ordered]@{ stopped = $true }
    }
    default { throw "Unsupported audio action: $Action" }
  }
}

function Invoke-ScreenRecordAction {
  param([string]$Action, [object]$Parameters)
  $statePath = Join-Path $env:TEMP 'lnwjud-screen-record-state.json'
  switch ($Action) {
    'start' {
      $ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
      if ($null -eq $ffmpeg) { throw 'ffmpeg is not installed; install ffmpeg to use screen_record' }
      $out = [string](Get-Field $Parameters 'output_path')
      if ($out.Length -eq 0) { throw 'output_path is required' }
      $parent = Split-Path -Parent $out
      if (-not (Test-Path $parent -PathType Container)) { throw 'Output directory does not exist' }
      $x = Get-Field $Parameters 'offset_x'; if ($null -eq $x) { $x = 0 }
      $y = Get-Field $Parameters 'offset_y'; if ($null -eq $y) { $y = 0 }
      $w = Get-Field $Parameters 'width'; if ($null -eq $w) { $w = 1920 }
      $h = Get-Field $Parameters 'height'; if ($null -eq $h) { $h = 1080 }
      $fps = Get-Field $Parameters 'fps'; if ($null -eq $fps) { $fps = 10 }
      if ([int]$w -lt 1 -or [int]$h -lt 1 -or [int]$w -gt 7680 -or [int]$h -gt 4320) { throw 'Capture size is invalid' }
      if ([int]$fps -lt 1 -or [int]$fps -gt 60) { throw 'fps must be from 1 to 60' }
      $process = Start-Process -FilePath $ffmpeg -ArgumentList @('-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', [string][int]$fps, '-offset_x', [string][int]$x, '-offset_y', [string][int]$y, '-video_size', ([string][int]$w + 'x' + [string][int]$h), '-i', 'desktop', '-t', '3600', '-pix_fmt', 'yuv420p', $out) -WindowStyle Hidden -PassThru
      @{ pid = [int]$process.Id; output_path = $out; started_at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress | Set-Content $statePath
      return [ordered]@{ recording = $true; pid = [int]$process.Id; output_path = $out; max_duration_seconds = 3600 }
    }
    'stop' {
      if (-not (Test-Path $statePath)) { return [ordered]@{ recording = $false; reason = 'No active recording' } }
      $state = Get-Content $statePath -Raw | ConvertFrom-Json
      $process = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
      if ($null -ne $process) { Stop-Process -Id ([int]$state.pid) -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }
      Remove-Item $statePath -Force -ErrorAction SilentlyContinue
      return [ordered]@{ recording = $false; output_path = [string]$state.output_path; exists = (Test-Path $state.output_path) }
    }
    'status' {
      if (-not (Test-Path $statePath)) { return [ordered]@{ recording = $false } }
      $state = Get-Content $statePath -Raw | ConvertFrom-Json
      $alive = $null -ne (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue)
      return [ordered]@{ recording = $alive; pid = [int]$state.pid; output_path = [string]$state.output_path }
    }
    default { throw "Unsupported screen_record action: $Action" }
  }
}

function Release-ComObject {
  param([object]$Object)
  if ($null -eq $Object) { return }
  try {
    while ($true) {
      $refCount = [Runtime.InteropServices.Marshal]::ReleaseComObject($Object)
      if ($refCount -le 0) { break }
    }
  } catch { }
}

function Resolve-OutlookFolder {
  param([object]$Namespace, [string]$FolderPath, [int]$DefaultFolderKind)
  if ([string]::IsNullOrWhiteSpace($FolderPath)) { return $Namespace.GetDefaultFolder($DefaultFolderKind) }
  $segments = @($FolderPath.Trim('\').Split('\') | Where-Object { $_.Length -gt 0 })
  $folder = $null
  if ($segments.Count -ge 2) {
    try {
      $folder = $Namespace.Folders.Item([string]$segments[0])
      for ($index = 1; $index -lt $segments.Count; $index += 1) { $folder = $folder.Folders.Item([string]$segments[$index]) }
    } catch { $folder = $null }
  }
  if ($null -eq $folder -and $segments.Count -eq 1) {
    foreach ($store in $Namespace.Folders) {
      try { $folder = $store.Folders.Item([string]$segments[0]); if ($null -ne $folder) { break } } catch { }
    }
  }
  if ($null -eq $folder) { throw "Outlook folder was not found: $FolderPath" }
  return $folder
}

function Add-OutlookRecipients {
  param([object]$Mail, [object]$Values, [int]$Type)
  if ($null -eq $Values) { return }
  foreach ($address in @($Values)) {
    $text = [string]$address
    if ($text.Length -eq 0) { continue }
    $recipient = $Mail.Recipients.Add($text)
    $recipient.Type = $Type
    [void]$recipient.Resolve()
  }
}

function Invoke-OfficeAction {
  param([string]$App, [string]$Action, [object]$Parameters)
  if ($Action -eq 'status') {
    $progIds = @{
      excel = 'Excel.Application'; word = 'Word.Application'; powerpoint = 'PowerPoint.Application'; outlook = 'Outlook.Application'
      access = 'Access.Application'; visio = 'Visio.Application'; project = 'MSProject.Application'; publisher = 'Publisher.Application'
    }
    $progId = [string]$progIds[$App]
    if ($progId.Length -eq 0) { throw "Unsupported office app: $App" }
    $application = $null
    try {
      $application = New-Object -ComObject $progId
      $version = try { [string]$application.Version } catch { '' }
      return [ordered]@{ app = $App; action = 'status'; available = $true; ready = $true; provider = 'windows-office-com'; version = $version }
    } finally {
      if ($null -ne $application) {
        if ($App -ne 'outlook') { try { $application.Quit() } catch { } }
        Release-ComObject $application
      }
    }
  }
  $filePath = [string](Get-Field $Parameters 'file_path')
  if ($App -eq 'excel') {
    $excel = $null
    try {
      $excel = New-Object -ComObject Excel.Application
      $excel.Visible = $false
      $excel.DisplayAlerts = $false
      $excelAction = $Action
      if ($excelAction -in @('read_range', 'read_values')) { $excelAction = 'read' }
      elseif ($excelAction -eq 'write_values') { $excelAction = 'write' }
      elseif ($excelAction -eq 'list_sheets') { $excelAction = 'sheets' }
      switch ($excelAction) {
        'read' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = Get-Field $Parameters 'sheet'
            $range = [string](Get-Field $Parameters 'range')
            if ($range.Length -eq 0) { throw 'range is required (for example A1:D10)' }
            $worksheet = if ($null -eq $sheetName -or $sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $values = $worksheet.Range($range).Value2
            return [ordered]@{ app = 'excel'; action = 'read'; file_path = $filePath; range = $range; values = @($values) }
          } finally { $workbook.Close($false) }
        }
        'write' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
          $values = Get-Field $Parameters 'values'; if ($null -eq $values) { throw 'values is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = Get-Field $Parameters 'sheet'
            $worksheet = if ($null -eq $sheetName -or $sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $target = $worksheet.Range($range)
            $excelValues = ConvertTo-ExcelRangeValues $values $target
            $null = $target.Value2 = $excelValues
            $workbook.Save()
            return [ordered]@{ app = 'excel'; action = 'write'; file_path = $filePath; range = $range; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'save_as' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
            $workbook.SaveAs($target)
            return [ordered]@{ app = 'excel'; action = 'save_as'; source = $filePath; target = $target; saved = $true }
          } finally { $workbook.Close($false) }
        }
        'sheets' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $sheets = @()
            foreach ($worksheet in $workbook.Worksheets) {
              $used = $worksheet.UsedRange
              $sheets += [ordered]@{
                name = [string]$worksheet.Name
                used_range = [string]$used.Address($false, $false)
                rows = [int]$used.Rows.Count
                columns = [int]$used.Columns.Count
              }
            }
            return [ordered]@{ app = 'excel'; action = 'sheets'; file_path = $filePath; sheets = $sheets }
          } finally { $workbook.Close($false) }
        }
        'create' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $workbook = $excel.Workbooks.Add()
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet')
            if ($sheetName.Length -gt 0) { $workbook.Worksheets.Item(1).Name = $sheetName }
            $workbook.SaveAs($filePath)
            return [ordered]@{ app = 'excel'; action = 'create'; file_path = $filePath; saved = $true }
          } finally { $workbook.Close($false) }
        }
        'inspect_workbook' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $sheets = @()
            foreach ($worksheet in $workbook.Worksheets) {
              $used = $worksheet.UsedRange
              $sheets += [ordered]@{ name = [string]$worksheet.Name; used_range = [string]$used.Address($false, $false); rows = [int]$used.Rows.Count; columns = [int]$used.Columns.Count }
            }
            return [ordered]@{ app = 'excel'; action = 'inspect_workbook'; file_path = $filePath; sheet_count = [int]$workbook.Worksheets.Count; sheets = $sheets; read_only = [bool]$workbook.ReadOnly }
          } finally { $workbook.Close($false) }
        }
        'used_range' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet')
            $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $used = $worksheet.UsedRange
            return [ordered]@{ app = 'excel'; action = 'used_range'; sheet = [string]$worksheet.Name; range = [string]$used.Address($false, $false); rows = [int]$used.Rows.Count; columns = [int]$used.Columns.Count }
          } finally { $workbook.Close($false) }
        }
        'read_formulas' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet')
            $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            return [ordered]@{ app = 'excel'; action = 'read_formulas'; sheet = [string]$worksheet.Name; range = $range; formulas = @($worksheet.Range($range).Formula) }
          } finally { $workbook.Close($false) }
        }
        'write_formulas' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
          $formulas = Get-Field $Parameters 'formulas'; if ($null -eq $formulas) { throw 'formulas is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet')
            $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $target = $worksheet.Range($range)
            $excelFormulas = ConvertTo-ExcelRangeValues $formulas $target
            $target.Formula = $excelFormulas
            $workbook.Save()
            return [ordered]@{ app = 'excel'; action = 'write_formulas'; sheet = [string]$worksheet.Name; range = $range; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'add_sheet' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $worksheet = $workbook.Worksheets.Add()
            $name = [string](Get-Field $Parameters 'name'); if ($name.Length -gt 0) { $worksheet.Name = $name }
            $workbook.Save()
            return [ordered]@{ app = 'excel'; action = 'add_sheet'; sheet = [string]$worksheet.Name; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'delete_sheet' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $sheetName = [string](Get-Field $Parameters 'sheet'); if ($sheetName.Length -eq 0) { throw 'sheet is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try { $workbook.Worksheets.Item($sheetName).Delete(); $workbook.Save(); return [ordered]@{ app = 'excel'; action = 'delete_sheet'; sheet = $sheetName; saved = $true } }
          finally { $workbook.Close($true) }
        }
        'rename_sheet' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $sheetName = [string](Get-Field $Parameters 'sheet'); $newName = [string](Get-Field $Parameters 'new_name')
          if ($sheetName.Length -eq 0 -or $newName.Length -eq 0) { throw 'sheet and new_name are required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try { $workbook.Worksheets.Item($sheetName).Name = $newName; $workbook.Save(); return [ordered]@{ app = 'excel'; action = 'rename_sheet'; sheet = $newName; saved = $true } }
          finally { $workbook.Close($true) }
        }
        'autofit' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $range = [string](Get-Field $Parameters 'range')
            $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            if ($range.Length -eq 0) { $worksheet.UsedRange.Columns.AutoFit() | Out-Null; $worksheet.UsedRange.Rows.AutoFit() | Out-Null } else { $worksheet.Range($range).Columns.AutoFit() | Out-Null; $worksheet.Range($range).Rows.AutoFit() | Out-Null }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = 'autofit'; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'set_number_format' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
          $parametersValue = Get-Field $Parameters 'parameters'; $format = [string](Get-Field $parametersValue 'format')
          if ($format.Length -eq 0) { throw 'parameters.format is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $worksheet.Range($range).NumberFormat = $format; $workbook.Save()
            return [ordered]@{ app = 'excel'; action = 'set_number_format'; range = $range; format = $format; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'recalculate' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath)
          try { $excel.CalculateFullRebuild(); $workbook.Save(); return [ordered]@{ app = 'excel'; action = 'recalculate'; saved = $true } }
          finally { $workbook.Close($true) }
        }
        'save' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath)
          try { $workbook.Save(); return [ordered]@{ app = 'excel'; action = 'save'; file_path = $filePath; saved = $true } }
          finally { $workbook.Close($true) }
        }
        'export_pdf' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try { $workbook.ExportAsFixedFormat(0, $target); return [ordered]@{ app = 'excel'; action = 'export_pdf'; source = $filePath; target = $target; exported = $true } }
          finally { $workbook.Close($false) }
        }
        'export_csv' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try { $workbook.SaveAs($target, 6); return [ordered]@{ app = 'excel'; action = 'export_csv'; source = $filePath; target = $target; exported = $true } }
          finally { $workbook.Close($false) }
        }
        'export_tsv' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try { $workbook.SaveAs($target, 20); return [ordered]@{ app = 'excel'; action = 'export_tsv'; source = $filePath; target = $target; exported = $true } }
          finally { $workbook.Close($false) }
        }
        'workbook_properties' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try { return [ordered]@{ app = 'excel'; action = 'workbook_properties'; file_path = $filePath; name = [string]$workbook.Name; sheet_count = [int]$workbook.Worksheets.Count; read_only = [bool]$workbook.ReadOnly } }
          finally { $workbook.Close($false) }
        }
        'calculation_status' {
          return [ordered]@{ app = 'excel'; action = 'calculation_status'; calculation_state = [int]$excel.CalculationState; calculation_mode = [int]$excel.Calculation }
        }
        { $_ -in @('read_number_formats', 'read_styles') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $target = $worksheet.Range($range)
            if ($Action -eq 'read_number_formats') { return [ordered]@{ app = 'excel'; action = $Action; sheet = [string]$worksheet.Name; range = $range; number_formats = @($target.NumberFormat) } }
            return [ordered]@{ app = 'excel'; action = $Action; sheet = [string]$worksheet.Name; range = $range; font = [ordered]@{ name = [string]$target.Font.Name; size = [double]$target.Font.Size; bold = [int]$target.Font.Bold; italic = [int]$target.Font.Italic }; fill_color = [int64]$target.Interior.Color; horizontal_alignment = [int]$target.HorizontalAlignment; vertical_alignment = [int]$target.VerticalAlignment }
          } finally { $workbook.Close($false) }
        }
        'read_tables' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $tables = @()
            foreach ($worksheet in $workbook.Worksheets) {
              foreach ($table in $worksheet.ListObjects) { $tables += [ordered]@{ sheet = [string]$worksheet.Name; name = [string]$table.Name; range = [string]$table.Range.Address($false,$false); rows = [int]$table.Range.Rows.Count; columns = [int]$table.Range.Columns.Count; style = [string]$table.TableStyle } }
            }
            return [ordered]@{ app = 'excel'; action = $Action; tables = $tables }
          } finally { $workbook.Close($false) }
        }
        'read_charts' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $charts = @()
            foreach ($worksheet in $workbook.Worksheets) {
              foreach ($chartObject in $worksheet.ChartObjects()) { $charts += [ordered]@{ sheet = [string]$worksheet.Name; name = [string]$chartObject.Name; type = [int]$chartObject.Chart.ChartType; left = [double]$chartObject.Left; top = [double]$chartObject.Top; width = [double]$chartObject.Width; height = [double]$chartObject.Height } }
            }
            return [ordered]@{ app = 'excel'; action = $Action; charts = $charts }
          } finally { $workbook.Close($false) }
        }
        'read_pivots' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $pivots = @()
            foreach ($worksheet in $workbook.Worksheets) { foreach ($pivot in $worksheet.PivotTables()) { $pivots += [ordered]@{ sheet = [string]$worksheet.Name; name = [string]$pivot.Name; range = [string]$pivot.TableRange2.Address($false,$false) } } }
            return [ordered]@{ app = 'excel'; action = $Action; pivots = $pivots }
          } finally { $workbook.Close($false) }
        }
        'search' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $query = [string](Get-Field $Parameters 'name'); if ($query.Length -eq 0) { $query = [string](Get-Field (Get-Field $Parameters 'parameters') 'query') }; if ($query.Length -eq 0) { throw 'name or parameters.query is required' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $hits = @()
            foreach ($worksheet in $workbook.Worksheets) {
              $range = $worksheet.UsedRange
              foreach ($cell in $range.Cells) {
                if ($hits.Count -ge 500) { break }
                $value = [string]$cell.Text
                if ($value.IndexOf($query, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $hits += [ordered]@{ sheet = [string]$worksheet.Name; address = [string]$cell.Address($false,$false); value = $value } }
              }
              if ($hits.Count -ge 500) { break }
            }
            return [ordered]@{ app = 'excel'; action = $Action; query = $query; hits = $hits; truncated = ($hits.Count -ge 500) }
          } finally { $workbook.Close($false) }
        }
        { $_ -in @('fill_range', 'clear_contents', 'clear_formats', 'merge_cells', 'unmerge_cells') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }; $target = $worksheet.Range($range)
            if ($Action -eq 'fill_range') {
              $fillValues = Get-Field $Parameters 'values'
              if ($null -eq $fillValues) { throw 'values is required' }
              $target.Value2 = ConvertTo-ExcelRangeValues $fillValues $target
            }
            elseif ($Action -eq 'clear_contents') { $target.ClearContents() | Out-Null }
            elseif ($Action -eq 'clear_formats') { $target.ClearFormats() | Out-Null }
            elseif ($Action -eq 'merge_cells') { $target.Merge() }
            else { $target.UnMerge() }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; range = $range; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'copy_range' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); $options = Get-Field $Parameters 'parameters'; $destination = [string](Get-Field $options 'destination')
          if ($range.Length -eq 0 -or $destination.Length -eq 0) { throw 'range and parameters.destination are required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $worksheet.Range($range).Copy($worksheet.Range($destination)); $workbook.Save()
            return [ordered]@{ app = 'excel'; action = $Action; source = $range; destination = $destination; saved = $true }
          } finally { $workbook.Close($true) }
        }
        { $_ -in @('insert_rows', 'delete_rows', 'insert_columns', 'delete_columns') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }; $target = $worksheet.Range($range)
            if ($Action -eq 'insert_rows') { $target.EntireRow.Insert() | Out-Null }
            elseif ($Action -eq 'delete_rows') { $target.EntireRow.Delete() | Out-Null }
            elseif ($Action -eq 'insert_columns') { $target.EntireColumn.Insert() | Out-Null }
            else { $target.EntireColumn.Delete() | Out-Null }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; range = $range; saved = $true }
          } finally { $workbook.Close($true) }
        }
        { $_ -in @('set_row_height', 'set_column_width', 'set_font', 'set_fill', 'set_alignment') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }; $options = Get-Field $Parameters 'parameters'
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }; $target = $worksheet.Range($range)
            if ($Action -eq 'set_row_height') { $target.RowHeight = [double](Get-Field $options 'height') }
            elseif ($Action -eq 'set_column_width') { $target.ColumnWidth = [double](Get-Field $options 'width') }
            elseif ($Action -eq 'set_font') {
              $name = Get-Field $options 'name'; if ($null -ne $name) { $target.Font.Name = [string]$name }
              $size = Get-Field $options 'size'; if ($null -ne $size) { $target.Font.Size = [double]$size }
              $bold = Get-Field $options 'bold'; if ($null -ne $bold) { $target.Font.Bold = [bool]$bold }
              $italic = Get-Field $options 'italic'; if ($null -ne $italic) { $target.Font.Italic = [bool]$italic }
            }
            elseif ($Action -eq 'set_fill') { $target.Interior.Color = [int64](Get-Field $options 'color') }
            else {
              $horizontal = Get-Field $options 'horizontal'; if ($null -ne $horizontal) { $target.HorizontalAlignment = [int]$horizontal }
              $vertical = Get-Field $options 'vertical'; if ($null -ne $vertical) { $target.VerticalAlignment = [int]$vertical }
              $wrap = Get-Field $options 'wrap_text'; if ($null -ne $wrap) { $target.WrapText = [bool]$wrap }
            }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; range = $range; saved = $true }
          } finally { $workbook.Close($true) }
        }
        { $_ -in @('create_table', 'resize_table', 'style_table') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            $options = Get-Field $Parameters 'parameters'; $name = [string](Get-Field $Parameters 'name')
            if ($Action -eq 'create_table') {
              $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
              $table = $worksheet.ListObjects.Add(1, $worksheet.Range($range), $null, 1)
              if ($name.Length -gt 0) { $table.Name = $name }
            } else {
              if ($name.Length -eq 0) { throw 'name is required' }
              $table = $worksheet.ListObjects.Item($name)
              if ($Action -eq 'resize_table') { $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }; $table.Resize($worksheet.Range($range)) }
            }
            $style = [string](Get-Field $options 'style'); if ($style.Length -gt 0) { $table.TableStyle = $style }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; name = [string]$table.Name; range = [string]$table.Range.Address($false,$false); saved = $true }
          } finally { $workbook.Close($true) }
        }
        { $_ -in @('sort', 'filter', 'clear_filter') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0 -and $Action -ne 'clear_filter') { throw 'range is required' }
          $options = Get-Field $Parameters 'parameters'
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            if ($Action -eq 'clear_filter') { if ($worksheet.AutoFilterMode) { $worksheet.AutoFilterMode = $false } }
            elseif ($Action -eq 'filter') {
              $field = [int](Get-Field $options 'field'); if ($field -le 0) { $field = 1 }
              $criteria = Get-Field $options 'criteria'; if ($null -eq $criteria) { throw 'parameters.criteria is required' }
              $worksheet.Range($range).AutoFilter($field, $criteria) | Out-Null
            } else {
              $key = [string](Get-Field $options 'key_range'); if ($key.Length -eq 0) { $key = $range }
              $order = [int](Get-Field $options 'order'); if ($order -ne 2) { $order = 1 }
              $worksheet.Range($range).Sort($worksheet.Range($key), $order) | Out-Null
            }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'freeze_panes' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $options = Get-Field $Parameters 'parameters'; $rows = [int](Get-Field $options 'rows'); $columns = [int](Get-Field $options 'columns')
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }; $worksheet.Activate()
            $excel.ActiveWindow.FreezePanes = $false; $excel.ActiveWindow.SplitRow = [Math]::Max(0,$rows); $excel.ActiveWindow.SplitColumn = [Math]::Max(0,$columns); $excel.ActiveWindow.FreezePanes = ($rows -gt 0 -or $columns -gt 0)
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; rows = $rows; columns = $columns; saved = $true }
          } finally { $workbook.Close($true) }
        }
        { $_ -in @('set_data_validation', 'delete_data_validation') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }; $options = Get-Field $Parameters 'parameters'
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }; $target = $worksheet.Range($range)
            $target.Validation.Delete()
            if ($Action -eq 'set_data_validation') {
              $kind = [string](Get-Field $options 'type'); $formula = [string](Get-Field $options 'formula1'); if ($formula.Length -eq 0) { throw 'parameters.formula1 is required' }
              $formula2 = [string](Get-Field $options 'formula2')
              $validationType = if ($kind -eq 'whole') { 1 } elseif ($kind -eq 'decimal') { 2 } else { 3 }
              $operatorRaw = Get-Field $options 'operator'
              $operator = if ($formula2.Length -gt 0) { 1 } else { 3 }
              if ($null -ne $operatorRaw) {
                if ($operatorRaw -is [int] -or $operatorRaw -is [long] -or $operatorRaw -is [double]) { $operator = [int]$operatorRaw }
                else {
                  switch (([string]$operatorRaw).ToLowerInvariant()) {
                    'between' { $operator = 1 }
                    'not_between' { $operator = 2 }
                    'equal' { $operator = 3 }
                    'not_equal' { $operator = 4 }
                    'greater' { $operator = 5 }
                    'less' { $operator = 6 }
                    'greater_or_equal' { $operator = 7 }
                    'less_or_equal' { $operator = 8 }
                    default { throw 'parameters.operator is invalid' }
                  }
                }
              }
              if ($validationType -eq 3) { $target.Validation.Add($validationType, 1, 1, $formula) }
              elseif ($formula2.Length -gt 0) { $target.Validation.Add($validationType, 1, $operator, $formula, $formula2) }
              else { $target.Validation.Add($validationType, 1, $operator, $formula) }
            }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; range = $range; saved = $true }
          } finally { $workbook.Close($true) }
        }
        'add_comment' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }; $text = [string](Get-Field (Get-Field $Parameters 'parameters') 'text')
          $workbook = $excel.Workbooks.Open($filePath)
          try { $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }; $cell = $worksheet.Range($range); if ($null -ne $cell.Comment) { $cell.Comment.Delete() }; [void]$cell.AddComment($text); $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; range = $range; saved = $true } }
          finally { $workbook.Close($true) }
        }
        'insert_image' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $imagePath = [string](Get-Field $Parameters 'image_path'); if ($imagePath.Length -eq 0 -or -not (Test-Path $imagePath -PathType Leaf)) { throw 'image_path is required and must exist' }
          $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { $range = 'A1' }
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }; $anchor = $worksheet.Range($range)
            $shape = $worksheet.Shapes.AddPicture($imagePath, $false, $true, [double]$anchor.Left, [double]$anchor.Top, -1, -1)
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; shape = [string]$shape.Name; saved = $true }
          } finally { $workbook.Close($true) }
        }
        { $_ -in @('create_chart', 'update_chart', 'delete_chart') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $options = Get-Field $Parameters 'parameters'; $name = [string](Get-Field $Parameters 'name')
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $sheetName = [string](Get-Field $Parameters 'sheet'); $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            if ($Action -eq 'create_chart') {
              $range = [string](Get-Field $Parameters 'range'); if ($range.Length -eq 0) { throw 'range is required' }
              $left = [double](Get-Field $options 'left'); if ($left -eq 0) { $left = 320 }; $top = [double](Get-Field $options 'top'); if ($top -eq 0) { $top = 20 }
              $width = [double](Get-Field $options 'width'); if ($width -le 0) { $width = 480 }; $height = [double](Get-Field $options 'height'); if ($height -le 0) { $height = 280 }
              $chartObject = $worksheet.ChartObjects().Add($left,$top,$width,$height); if ($name.Length -gt 0) { $chartObject.Name = $name }
              $chartObject.Chart.SetSourceData($worksheet.Range($range))
              $chartType = Get-Field $options 'chart_type'; if ($null -ne $chartType) { $chartObject.Chart.ChartType = [int]$chartType }
            } else {
              if ($name.Length -eq 0) { throw 'name is required' }
              $chartObject = $worksheet.ChartObjects($name)
              if ($Action -eq 'delete_chart') { $chartObject.Delete(); $chartObject = $null }
              else {
                $range = [string](Get-Field $Parameters 'range'); if ($range.Length -gt 0) { $chartObject.Chart.SetSourceData($worksheet.Range($range)) }
                $chartType = Get-Field $options 'chart_type'; if ($null -ne $chartType) { $chartObject.Chart.ChartType = [int]$chartType }
              }
            }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; name = $name; saved = $true }
          } finally { $workbook.Close($true) }
        }
        { $_ -in @('create_pivot', 'refresh_pivot', 'update_pivot') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $options = Get-Field $Parameters 'parameters'; $name = [string](Get-Field $Parameters 'name')
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            if ($Action -eq 'create_pivot') {
              $sheetName = [string](Get-Field $Parameters 'sheet'); $sourceSheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
              $sourceAddress = [string](Get-Field $Parameters 'range'); if ($sourceAddress.Length -eq 0) { throw 'range is required' }
              $targetSheetName = [string](Get-Field $options 'target_sheet'); $targetSheet = if ($targetSheetName.Length -eq 0) { $sourceSheet } else { $workbook.Worksheets.Item($targetSheetName) }
              $destination = [string](Get-Field $options 'destination'); if ($destination.Length -eq 0) { $destination = 'A1' }
              if ($name.Length -eq 0) { $name = 'Pivot_' + [Guid]::NewGuid().ToString('N').Substring(0,8) }
              $sourceRange = $sourceSheet.Range($sourceAddress)
              # Excel documents recommend a workbook/worksheet/range string here; passing a Range
              # object can fail unpredictably across Office builds and leave a PivotTable without
              # usable PivotFields. External R1C1 keeps the cache source unambiguous.
              $sourceData = [string]$sourceRange.Address($true, $true, -4150, $true)
              $cache = $workbook.PivotCaches().Create(1, $sourceData)
              $pivot = $cache.CreatePivotTable($targetSheet.Range($destination), $name)
              foreach ($fieldName in @(Get-Field $options 'row_fields')) {
                if ([string]$fieldName -eq '') { continue }
                $field = $pivot.PivotFields([string]$fieldName); $field.Orientation = 1; $field.Position = $pivot.RowFields().Count
              }
              foreach ($fieldName in @(Get-Field $options 'column_fields')) {
                if ([string]$fieldName -eq '') { continue }
                $field = $pivot.PivotFields([string]$fieldName); $field.Orientation = 2; $field.Position = $pivot.ColumnFields().Count
              }
              foreach ($fieldName in @(Get-Field $options 'data_fields')) {
                if ([string]$fieldName -eq '') { continue }
                [void]$pivot.AddDataField($pivot.PivotFields([string]$fieldName), ('Sum of ' + [string]$fieldName), -4157)
              }
            } else {
              if ($name.Length -eq 0) { throw 'name is required' }
              $pivot = $null
              foreach ($worksheet in $workbook.Worksheets) {
                try { $pivot = $worksheet.PivotTables($name); if ($null -ne $pivot) { break } } catch { }
              }
              if ($null -eq $pivot) { throw "Pivot table was not found: $name" }
              $pivot.RefreshTable() | Out-Null
            }
            $workbook.Save()
            return [ordered]@{ app = 'excel'; action = $Action; name = [string]$pivot.Name; range = [string]$pivot.TableRange2.Address($false,$false); saved = $true }
          } finally { $workbook.Close($true) }
        }
        'formula_errors' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $workbook = $excel.Workbooks.Open($filePath, 0, $true)
          try {
            $errors = @()
            foreach ($worksheet in $workbook.Worksheets) {
              foreach ($cell in $worksheet.UsedRange.Cells) {
                if ($errors.Count -ge 500) { break }
                $text = [string]$cell.Text
                if ($text -match '^#(NULL!|DIV/0!|VALUE!|REF!|NAME\?|NUM!|N/A|GETTING_DATA)') { $errors += [ordered]@{ sheet = [string]$worksheet.Name; address = [string]$cell.Address($false,$false); value = $text; formula = [string]$cell.Formula } }
              }
              if ($errors.Count -ge 500) { break }
            }
            return [ordered]@{ app = 'excel'; action = $Action; errors = $errors; truncated = ($errors.Count -ge 500) }
          } finally { $workbook.Close($false) }
        }
        { $_ -in @('protect', 'unprotect') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Excel file was not found' }
          $sheetName = [string](Get-Field $Parameters 'sheet'); $password = [string](Get-Field $Parameters 'password')
          $workbook = $excel.Workbooks.Open($filePath)
          try {
            $worksheet = if ($sheetName.Length -eq 0) { $workbook.Worksheets.Item(1) } else { $workbook.Worksheets.Item($sheetName) }
            if ($Action -eq 'protect') { $worksheet.Protect($password) } else { $worksheet.Unprotect($password) }
            $workbook.Save(); return [ordered]@{ app = 'excel'; action = $Action; sheet = [string]$worksheet.Name; protected = [bool]$worksheet.ProtectContents; saved = $true }
          } finally { $workbook.Close($true) }
        }
        default { throw "Unsupported excel action: $Action" }
      }
    } finally {
      if ($null -ne $excel) { try { $excel.Quit() } catch { }; Release-ComObject $excel }
    }
  }
  if ($App -eq 'word') {
    $word = $null
    try {
      $word = New-Object -ComObject Word.Application
      $word.Visible = $false
      $word.DisplayAlerts = 0
      $wordAction = $Action
      if ($wordAction -eq 'replace_text') { $wordAction = 'replace' }
      switch ($wordAction) {
        'read_text' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try { return [ordered]@{ app = 'word'; action = 'read_text'; file_path = $filePath; text = [string]$document.Content.Text } }
          finally { $document.Close($false) }
        }
        'replace' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $find = [string](Get-Field $Parameters 'find'); if ($find.Length -eq 0) { throw 'find is required' }
          $replaceWith = [string](Get-Field $Parameters 'replace_with')
          $document = $word.Documents.Open($filePath)
          try {
            $findObject = $document.Content.Find
            $found = $findObject.Execute($find, $false, $false, $false, $false, $false, $true, 1, $false, $replaceWith, 2)
            $document.Save()
            return [ordered]@{ app = 'word'; action = 'replace'; file_path = $filePath; replaced = [bool]$found; saved = $true }
          } finally { $document.Close($true) }
        }
        'save_as' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
            $document.SaveAs($target)
            return [ordered]@{ app = 'word'; action = 'save_as'; source = $filePath; target = $target; saved = $true }
          } finally { $document.Close($false) }
        }
        'merge' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
          $mergePaths = @(Get-Field $Parameters 'merge_paths')
          if ($mergePaths.Count -eq 0) { throw 'merge_paths is required' }
          $document = $word.Documents.Open($filePath)
          try {
            foreach ($mergePath in $mergePaths) {
              $source = [string]$mergePath
              if ($source.Length -eq 0) { continue }
              if (-not (Test-Path $source -PathType Leaf)) { throw "Merge source was not found: $source" }
              $endRange = $document.Content
              $endRange.Collapse(0)
              $endRange.InsertFile($source)
            }
            $document.SaveAs($target)
            return [ordered]@{ app = 'word'; action = 'merge'; source = $filePath; merged = @($mergePaths); target = $target; saved = $true }
          } finally { $document.Close($false) }
        }
        'create' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $document = $word.Documents.Add()
          try {
            $text = [string](Get-Field $Parameters 'text')
            if ($text.Length -gt 0) { $document.Content.Text = $text }
            $document.SaveAs2($filePath)
            return [ordered]@{ app = 'word'; action = 'create'; file_path = $filePath; saved = $true }
          } finally { $document.Close($false) }
        }
        'inspect_document' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            return [ordered]@{
              app = 'word'; action = 'inspect_document'; file_path = $filePath
              characters = [int]$document.Characters.Count; paragraphs = [int]$document.Paragraphs.Count
              sections = [int]$document.Sections.Count; tables = [int]$document.Tables.Count
              words = [int]$document.Words.Count; pages = [int]$document.ComputeStatistics(2)
              protection_type = [int]$document.ProtectionType
            }
          } finally { $document.Close($false) }
        }
        'get_structure' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            return [ordered]@{ app = 'word'; action = 'get_structure'; paragraphs = [int]$document.Paragraphs.Count; sections = [int]$document.Sections.Count; tables = [int]$document.Tables.Count; bookmarks = [int]$document.Bookmarks.Count; fields = [int]$document.Fields.Count; comments = [int]$document.Comments.Count; revisions = [int]$document.Revisions.Count }
          } finally { $document.Close($false) }
        }
        'get_paragraphs' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $paragraphs = @(); $count = 0
            foreach ($paragraph in $document.Paragraphs) {
              if ($count -ge 500) { break }; $count += 1
              $paragraphs += [ordered]@{ index = $count; text = [string]$paragraph.Range.Text; style = try { [string]$paragraph.Range.Style.NameLocal } catch { '' } }
            }
            return [ordered]@{ app = 'word'; action = 'get_paragraphs'; paragraphs = $paragraphs; truncated = ([int]$document.Paragraphs.Count -gt $count) }
          } finally { $document.Close($false) }
        }
        'get_headings' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $headings = @(); $index = 0
            foreach ($paragraph in $document.Paragraphs) {
              $index += 1; $style = try { [string]$paragraph.Range.Style.NameLocal } catch { '' }
              if ($style -match 'Heading|หัวเรื่อง') { $headings += [ordered]@{ paragraph = $index; style = $style; text = [string]$paragraph.Range.Text } }
            }
            return [ordered]@{ app = 'word'; action = 'get_headings'; headings = $headings }
          } finally { $document.Close($false) }
        }
        'get_tables' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $tables = @(); $index = 0
            foreach ($table in $document.Tables) {
              $index += 1; $tables += [ordered]@{ index = $index; rows = [int]$table.Rows.Count; columns = [int]$table.Columns.Count; text = [string]$table.Range.Text }
            }
            return [ordered]@{ app = 'word'; action = 'get_tables'; tables = $tables }
          } finally { $document.Close($false) }
        }
        'get_sections' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $sections = @(); $index = 0
            foreach ($section in $document.Sections) { $index += 1; $sections += [ordered]@{ index = $index; start = [int]$section.Range.Start; end = [int]$section.Range.End } }
            return [ordered]@{ app = 'word'; action = 'get_sections'; sections = $sections }
          } finally { $document.Close($false) }
        }
        'search' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $query = [string](Get-Field $Parameters 'find'); if ($query.Length -eq 0) { $query = [string](Get-Field $Parameters 'text') }
          if ($query.Length -eq 0) { throw 'find or text is required' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $content = [string]$document.Content.Text; $hits = @(); $offset = 0
            while ($hits.Count -lt 200) {
              $foundAt = $content.IndexOf($query, $offset, [System.StringComparison]::OrdinalIgnoreCase)
              if ($foundAt -lt 0) { break }
              $hits += [ordered]@{ start = $foundAt; end = ($foundAt + $query.Length) }
              $offset = $foundAt + [Math]::Max(1, $query.Length)
            }
            return [ordered]@{ app = 'word'; action = 'search'; query = $query; hits = $hits; truncated = ($hits.Count -ge 200) }
          } finally { $document.Close($false) }
        }
        'document_properties' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try { return [ordered]@{ app = 'word'; action = 'document_properties'; name = [string]$document.Name; full_name = [string]$document.FullName; saved = [bool]$document.Saved; read_only = [bool]$document.ReadOnly; protection_type = [int]$document.ProtectionType } }
          finally { $document.Close($false) }
        }
        'protection_status' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try { return [ordered]@{ app = 'word'; action = 'protection_status'; protection_type = [int]$document.ProtectionType } }
          finally { $document.Close($false) }
        }
        'append_text' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $text = [string](Get-Field $Parameters 'text'); $document = $word.Documents.Open($filePath)
          try { $range = $document.Content; $range.Collapse(0); $range.InsertAfter($text); $document.Save(); return [ordered]@{ app = 'word'; action = 'append_text'; saved = $true } }
          finally { $document.Close($true) }
        }
        'prepend_text' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $text = [string](Get-Field $Parameters 'text'); $document = $word.Documents.Open($filePath)
          try { $range = $document.Range(0, 0); $range.InsertBefore($text); $document.Save(); return [ordered]@{ app = 'word'; action = 'prepend_text'; saved = $true } }
          finally { $document.Close($true) }
        }
        'insert_text' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $text = [string](Get-Field $Parameters 'text'); $rangeSpec = Get-Field $Parameters 'range'; $start = [int](Get-Field $rangeSpec 'start')
          $document = $word.Documents.Open($filePath)
          try { $range = $document.Range($start, $start); $range.InsertAfter($text); $document.Save(); return [ordered]@{ app = 'word'; action = 'insert_text'; start = $start; saved = $true } }
          finally { $document.Close($true) }
        }
        'save' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath)
          try { $document.Save(); return [ordered]@{ app = 'word'; action = 'save'; file_path = $filePath; saved = $true } }
          finally { $document.Close($true) }
        }
        'export_pdf' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try { $document.ExportAsFixedFormat($target, 17); return [ordered]@{ app = 'word'; action = 'export_pdf'; source = $filePath; target = $target; exported = $true } }
          finally { $document.Close($false) }
        }
        'export_text' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try { $document.SaveAs2($target, 2); return [ordered]@{ app = 'word'; action = 'export_text'; source = $filePath; target = $target; exported = $true } }
          finally { $document.Close($false) }
        }
        'read_range' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $rangeSpec = Get-Field $Parameters 'range'; if ($null -eq $rangeSpec) { throw 'range is required' }
          $start = [int](Get-Field $rangeSpec 'start'); $endValue = Get-Field $rangeSpec 'end'
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $end = if ($null -eq $endValue) { [int]$document.Content.End } else { [int]$endValue }
            if ($start -lt 0 -or $end -lt $start -or $end -gt [int]$document.Content.End) { throw 'range is outside the document' }
            return [ordered]@{ app = 'word'; action = $Action; start = $start; end = $end; text = [string]$document.Range($start, $end).Text }
          } finally { $document.Close($false) }
        }
        'get_images' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $images = @(); $index = 0
            foreach ($image in $document.InlineShapes) { $index += 1; $images += [ordered]@{ index = $index; kind = 'inline'; type = [int]$image.Type; width = [double]$image.Width; height = [double]$image.Height; start = [int]$image.Range.Start; end = [int]$image.Range.End } }
            foreach ($shape in $document.Shapes) { $index += 1; $images += [ordered]@{ index = $index; kind = 'floating'; name = [string]$shape.Name; type = [int]$shape.Type; width = [double]$shape.Width; height = [double]$shape.Height } }
            return [ordered]@{ app = 'word'; action = $Action; images = $images }
          } finally { $document.Close($false) }
        }
        'get_headers_footers' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $items = @(); $sectionIndex = 0
            foreach ($section in $document.Sections) {
              $sectionIndex += 1
              foreach ($kind in @(1,2,3)) {
                try { $items += [ordered]@{ section = $sectionIndex; kind = $kind; header = [string]$section.Headers.Item($kind).Range.Text; footer = [string]$section.Footers.Item($kind).Range.Text } } catch { }
              }
            }
            return [ordered]@{ app = 'word'; action = $Action; items = $items }
          } finally { $document.Close($false) }
        }
        'get_bookmarks' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $items = @(); foreach ($bookmark in $document.Bookmarks) { $items += [ordered]@{ name = [string]$bookmark.Name; start = [int]$bookmark.Range.Start; end = [int]$bookmark.Range.End } }
            return [ordered]@{ app = 'word'; action = $Action; bookmarks = $items }
          } finally { $document.Close($false) }
        }
        'get_hyperlinks' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $items = @(); foreach ($link in $document.Hyperlinks) { $items += [ordered]@{ text = [string]$link.TextToDisplay; address = [string]$link.Address; sub_address = [string]$link.SubAddress; start = [int]$link.Range.Start } }
            return [ordered]@{ app = 'word'; action = $Action; hyperlinks = $items }
          } finally { $document.Close($false) }
        }
        { $_ -in @('get_comments', 'read_comments') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $items = @(); $index = 0
            foreach ($comment in $document.Comments) { $index += 1; $items += [ordered]@{ index = $index; author = [string]$comment.Author; initials = [string]$comment.Initial; text = [string]$comment.Range.Text; scope = [string]$comment.Scope.Text } }
            return [ordered]@{ app = 'word'; action = $Action; comments = $items }
          } finally { $document.Close($false) }
        }
        'get_revisions' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $document = $word.Documents.Open($filePath, $false, $true)
          try {
            $items = @(); $index = 0
            foreach ($revision in $document.Revisions) { $index += 1; $items += [ordered]@{ index = $index; author = [string]$revision.Author; type = [int]$revision.Type; text = [string]$revision.Range.Text; start = [int]$revision.Range.Start; end = [int]$revision.Range.End } }
            return [ordered]@{ app = 'word'; action = $Action; revisions = $items }
          } finally { $document.Close($false) }
        }
        'insert_table' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $tableSpec = Get-Field $Parameters 'table'; if ($null -eq $tableSpec) { throw 'table is required' }
          $rows = [int](Get-Field $tableSpec 'rows'); $columns = [int](Get-Field $tableSpec 'columns')
          if ($rows -le 0 -or $columns -le 0) { throw 'table.rows and table.columns must be positive integers' }
          $rangeSpec = Get-Field $Parameters 'range'
          $document = $word.Documents.Open($filePath)
          try {
            if ($null -eq $rangeSpec) { $range = $document.Content; $range.Collapse(0) } else { $start = [int](Get-Field $rangeSpec 'start'); $range = $document.Range($start, $start) }
            $table = $document.Tables.Add($range, $rows, $columns)
            $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; table = [int]$document.Tables.Count; rows = $rows; columns = $columns; saved = $true }
          } finally { $document.Close($true) }
        }
        'update_table_cells' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $tableSpec = Get-Field $Parameters 'table'; if ($null -eq $tableSpec) { throw 'table is required' }
          $tableIndex = [int](Get-Field $tableSpec 'index'); $row = [int](Get-Field $tableSpec 'row'); $column = [int](Get-Field $tableSpec 'column')
          if ($tableIndex -le 0 -or $row -le 0 -or $column -le 0) { throw 'table.index, table.row and table.column are required' }
          $text = [string](Get-Field $Parameters 'text')
          $document = $word.Documents.Open($filePath)
          try { $document.Tables.Item($tableIndex).Cell($row, $column).Range.Text = $text; $document.Save(); return [ordered]@{ app = 'word'; action = $Action; table = $tableIndex; row = $row; column = $column; saved = $true } }
          finally { $document.Close($true) }
        }
        { $_ -in @('add_row', 'delete_row', 'add_column', 'delete_column') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $tableSpec = Get-Field $Parameters 'table'; $tableIndex = [int](Get-Field $tableSpec 'index'); if ($tableIndex -le 0) { throw 'table.index is required' }
          $document = $word.Documents.Open($filePath)
          try {
            $table = $document.Tables.Item($tableIndex)
            if ($Action -eq 'add_row') { [void]$table.Rows.Add() }
            elseif ($Action -eq 'delete_row') { $row = [int](Get-Field $tableSpec 'row'); if ($row -le 0) { throw 'table.row is required' }; $table.Rows.Item($row).Delete() }
            elseif ($Action -eq 'add_column') { [void]$table.Columns.Add() }
            else { $column = [int](Get-Field $tableSpec 'column'); if ($column -le 0) { throw 'table.column is required' }; $table.Columns.Item($column).Delete() }
            $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; table = $tableIndex; rows = [int]$table.Rows.Count; columns = [int]$table.Columns.Count; saved = $true }
          } finally { $document.Close($true) }
        }
        'insert_image' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $imagePath = [string](Get-Field $Parameters 'image_path'); if ($imagePath.Length -eq 0 -or -not (Test-Path $imagePath -PathType Leaf)) { throw 'image_path is required and must exist' }
          $rangeSpec = Get-Field $Parameters 'range'
          $document = $word.Documents.Open($filePath)
          try {
            if ($null -eq $rangeSpec) { $range = $document.Content; $range.Collapse(0) } else { $start = [int](Get-Field $rangeSpec 'start'); $range = $document.Range($start, $start) }
            $shape = $document.InlineShapes.AddPicture($imagePath, $false, $true, $range)
            $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; width = [double]$shape.Width; height = [double]$shape.Height; saved = $true }
          } finally { $document.Close($true) }
        }
        'update_header_footer' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $options = Get-Field $Parameters 'parameters'; $sectionIndex = [int](Get-Field $options 'section'); if ($sectionIndex -le 0) { $sectionIndex = 1 }
          $kind = [int](Get-Field $options 'kind'); if ($kind -le 0) { $kind = 1 }
          $target = [string](Get-Field $options 'target'); if ($target.Length -eq 0) { $target = 'header' }
          $text = [string](Get-Field $Parameters 'text')
          $document = $word.Documents.Open($filePath)
          try {
            $section = $document.Sections.Item($sectionIndex)
            if ($target -eq 'footer') { $section.Footers.Item($kind).Range.Text = $text } else { $section.Headers.Item($kind).Range.Text = $text }
            $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; section = $sectionIndex; target = $target; saved = $true }
          } finally { $document.Close($true) }
        }
        'add_comment' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $rangeSpec = Get-Field $Parameters 'range'; if ($null -eq $rangeSpec) { throw 'range is required' }
          $start = [int](Get-Field $rangeSpec 'start'); $end = [int](Get-Field $rangeSpec 'end'); $text = [string](Get-Field $Parameters 'text')
          $document = $word.Documents.Open($filePath)
          try { [void]$document.Comments.Add($document.Range($start, $end), $text); $document.Save(); return [ordered]@{ app = 'word'; action = $Action; comments = [int]$document.Comments.Count; saved = $true } }
          finally { $document.Close($true) }
        }
        'set_track_changes' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $options = Get-Field $Parameters 'parameters'; $enabledValue = Get-Field $options 'enabled'; if ($null -eq $enabledValue) { throw 'parameters.enabled is required' }
          $document = $word.Documents.Open($filePath)
          try { $document.TrackRevisions = [bool]$enabledValue; $document.Save(); return [ordered]@{ app = 'word'; action = $Action; enabled = [bool]$document.TrackRevisions; saved = $true } }
          finally { $document.Close($true) }
        }
        { $_ -in @('accept_revision', 'reject_revision') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $index = [int](Get-Field $Parameters 'index'); if ($index -le 0) { throw 'index is required' }
          $document = $word.Documents.Open($filePath)
          try {
            $revision = $document.Revisions.Item($index)
            if ($Action -eq 'accept_revision') { $revision.Accept() } else { $revision.Reject() }
            $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; index = $index; remaining = [int]$document.Revisions.Count; saved = $true }
          } finally { $document.Close($true) }
        }
        'set_font' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $rangeSpec = Get-Field $Parameters 'range'; $style = Get-Field $Parameters 'style'; if ($null -eq $style) { throw 'style is required' }
          $document = $word.Documents.Open($filePath)
          try {
            if ($null -eq $rangeSpec) { $range = $document.Content } else { $range = $document.Range([int](Get-Field $rangeSpec 'start'), [int](Get-Field $rangeSpec 'end')) }
            $name = Get-Field $style 'name'; if ($null -ne $name) { $range.Font.Name = [string]$name }
            $size = Get-Field $style 'size'; if ($null -ne $size) { $range.Font.Size = [double]$size }
            $bold = Get-Field $style 'bold'; if ($null -ne $bold) { $range.Font.Bold = if ([bool]$bold) { -1 } else { 0 } }
            $italic = Get-Field $style 'italic'; if ($null -ne $italic) { $range.Font.Italic = if ([bool]$italic) { -1 } else { 0 } }
            $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; saved = $true }
          } finally { $document.Close($true) }
        }
        'apply_style' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $rangeSpec = Get-Field $Parameters 'range'; $style = Get-Field $Parameters 'style'; $styleName = [string](Get-Field $style 'name')
          if ($styleName.Length -eq 0) { throw 'style.name is required' }
          $document = $word.Documents.Open($filePath)
          try {
            if ($null -eq $rangeSpec) { $range = $document.Content } else { $range = $document.Range([int](Get-Field $rangeSpec 'start'), [int](Get-Field $rangeSpec 'end')) }
            $range.Style = $styleName; $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; style = $styleName; saved = $true }
          } finally { $document.Close($true) }
        }
        { $_ -in @('protect', 'unprotect') } {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'Word file was not found' }
          $options = Get-Field $Parameters 'parameters'; $password = [string](Get-Field $options 'password')
          $document = $word.Documents.Open($filePath)
          try {
            if ($Action -eq 'protect') {
              $kind = [int](Get-Field $options 'type'); if ($kind -lt 0) { $kind = 2 }
              if ($password.Length -gt 0) { $document.Protect($kind, $false, $password) } else { $document.Protect($kind) }
            } else {
              if ($password.Length -gt 0) { $document.Unprotect($password) } else { $document.Unprotect() }
            }
            $document.Save()
            return [ordered]@{ app = 'word'; action = $Action; protection_type = [int]$document.ProtectionType; saved = $true }
          } finally { $document.Close($true) }
        }
        default { throw "Unsupported word action: $Action" }
      }
    } finally {
      if ($null -ne $word) { try { $word.Quit() } catch { }; Release-ComObject $word }
    }
  }
  if ($App -eq 'powerpoint') {
    $powerpoint = $null
    try {
      $powerpoint = New-Object -ComObject PowerPoint.Application
      switch ($Action) {
        'read' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try {
            $slides = @()
            $index = 0
            foreach ($slide in $presentation.Slides) {
              $index += 1
              $texts = @()
              foreach ($shape in $slide.Shapes) {
                if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { $texts += [string]$shape.TextFrame.TextRange.Text }
              }
              $slides += [ordered]@{ slide = $index; texts = $texts }
            }
            return [ordered]@{ app = 'powerpoint'; action = 'read'; file_path = $filePath; slide_count = $index; slides = $slides }
          } finally { $presentation.Close() }
        }
        'create' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $presentation = $powerpoint.Presentations.Add()
          try {
            $text = [string](Get-Field $Parameters 'text')
            if ($text.Length -gt 0) {
              $slide = $presentation.Slides.Add(1, 12)
              [void]$slide.Shapes.AddTextbox(1, 48, 48, 620, 360).TextFrame.TextRange.InsertAfter($text)
            }
            $presentation.SaveAs($filePath)
            return [ordered]@{ app = 'powerpoint'; action = 'create'; file_path = $filePath; slide_count = [int]$presentation.Slides.Count; saved = $true }
          } finally { $presentation.Close() }
        }
        { $_ -in @('inspect_presentation', 'list_slides') } {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try {
            $slides = @()
            foreach ($slide in $presentation.Slides) {
              $texts = @()
              foreach ($shape in $slide.Shapes) {
                if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { $texts += [string]$shape.TextFrame.TextRange.Text }
              }
              $slides += [ordered]@{ slide = [int]$slide.SlideIndex; name = [string]$slide.Name; shape_count = [int]$slide.Shapes.Count; texts = $texts }
            }
            return [ordered]@{ app = 'powerpoint'; action = $Action; file_path = $filePath; slide_count = [int]$presentation.Slides.Count; slides = $slides; width = [double]$presentation.PageSetup.SlideWidth; height = [double]$presentation.PageSetup.SlideHeight }
          } finally { $presentation.Close() }
        }
        { $_ -in @('get_slide', 'get_slide_text', 'get_shapes', 'get_notes', 'get_layout') } {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try {
            if ($slideIndex -gt [int]$presentation.Slides.Count) { throw 'slide is outside the presentation range' }
            $slide = $presentation.Slides.Item($slideIndex)
            if ($Action -eq 'get_notes') {
              $notes = ''
              try { $notes = [string]$slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text } catch { }
              return [ordered]@{ app = 'powerpoint'; action = $Action; file_path = $filePath; slide = $slideIndex; notes = $notes }
            }
            if ($Action -eq 'get_layout') {
              return [ordered]@{ app = 'powerpoint'; action = $Action; file_path = $filePath; slide = $slideIndex; layout = [int]$slide.Layout; name = [string]$slide.Name }
            }
            $shapes = @()
            $texts = @()
            foreach ($shape in $slide.Shapes) {
              $textValue = ''
              try { if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { $textValue = [string]$shape.TextFrame.TextRange.Text; $texts += $textValue } } catch { }
              $shapes += [ordered]@{ index = [int]$shape.Id; name = [string]$shape.Name; type = [int]$shape.Type; left = [double]$shape.Left; top = [double]$shape.Top; width = [double]$shape.Width; height = [double]$shape.Height; text = $textValue }
            }
            return [ordered]@{ app = 'powerpoint'; action = $Action; file_path = $filePath; slide = $slideIndex; texts = $texts; shapes = if ($Action -eq 'get_slide_text') { @() } else { $shapes } }
          } finally { $presentation.Close() }
        }
        'presentation_properties' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try {
            return [ordered]@{ app = 'powerpoint'; action = $Action; file_path = $filePath; name = [string]$presentation.Name; slide_count = [int]$presentation.Slides.Count; width = [double]$presentation.PageSetup.SlideWidth; height = [double]$presentation.PageSetup.SlideHeight }
          } finally { $presentation.Close() }
        }
        'slide_size' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try { return [ordered]@{ app = 'powerpoint'; action = $Action; width = [double]$presentation.PageSetup.SlideWidth; height = [double]$presentation.PageSetup.SlideHeight } }
          finally { $presentation.Close() }
        }
        'add_slide' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $requested = [int](Get-Field $Parameters 'slide')
            $position = if ($requested -gt 0) { [Math]::Min($requested, [int]$presentation.Slides.Count + 1) } else { [int]$presentation.Slides.Count + 1 }
            $options = Get-Field $Parameters 'parameters'; $layout = 12
            if ($null -ne $options) { $layoutValue = Get-Field $options 'layout'; if ($null -ne $layoutValue) { $layout = [int]$layoutValue } }
            $slide = $presentation.Slides.Add($position, $layout)
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = [int]$slide.SlideIndex; saved = $true }
          } finally { $presentation.Close() }
        }
        'duplicate_slide' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $range = $presentation.Slides.Item($slideIndex).Duplicate()
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = [int]$range.Item(1).SlideIndex; saved = $true }
          } finally { $presentation.Close() }
        }
        'delete_slide' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try { $presentation.Slides.Item($slideIndex).Delete(); $presentation.Save(); return [ordered]@{ app = 'powerpoint'; action = $Action; deleted = $true; slide = $slideIndex } }
          finally { $presentation.Close() }
        }
        'reorder_slide' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); $targetSlide = [int](Get-Field $Parameters 'target_slide')
          if ($slideIndex -le 0 -or $targetSlide -le 0) { throw 'slide and target_slide must be positive integers' }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try { $presentation.Slides.Item($slideIndex).MoveTo($targetSlide); $presentation.Save(); return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; target_slide = $targetSlide; saved = $true } }
          finally { $presentation.Close() }
        }
        'edit_text' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $shapeId = Get-Field $Parameters 'shape'; if ($null -eq $shapeId) { throw 'shape is required' }
          $text = [string](Get-Field $Parameters 'text')
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $slide = $presentation.Slides.Item($slideIndex)
            $shape = $null
            try { $shape = $slide.Shapes.Item([string]$shapeId) } catch { try { $shape = $slide.Shapes.Item([int]$shapeId) } catch { } }
            if ($null -eq $shape) { throw 'PowerPoint shape was not found' }
            if (-not $shape.HasTextFrame) { throw 'PowerPoint shape does not support text' }
            $shape.TextFrame.TextRange.Text = $text
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; shape = [string]$shape.Name; saved = $true }
          } finally { $presentation.Close() }
        }
        'add_textbox' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $text = [string](Get-Field $Parameters 'text')
          $options = Get-Field $Parameters 'parameters'
          $left = 48; $top = 48; $width = 620; $height = 120
          if ($null -ne $options) {
            foreach ($field in @('left','top','width','height')) {
              $value = Get-Field $options $field
              if ($null -ne $value) { Set-Variable -Name $field -Value ([double]$value) }
            }
          }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $shape = $presentation.Slides.Item($slideIndex).Shapes.AddTextbox(1, $left, $top, $width, $height)
            $shape.TextFrame.TextRange.Text = $text
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; shape = [string]$shape.Name; saved = $true }
          } finally { $presentation.Close() }
        }
        'add_image' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $imagePath = [string](Get-Field $Parameters 'image_path'); if ($imagePath.Length -eq 0 -or -not (Test-Path $imagePath -PathType Leaf)) { throw 'image_path is required and must exist' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $options = Get-Field $Parameters 'parameters'
          $left = 48; $top = 48; $width = -1; $height = -1
          if ($null -ne $options) {
            foreach ($field in @('left','top','width','height')) {
              $value = Get-Field $options $field
              if ($null -ne $value) { Set-Variable -Name $field -Value ([double]$value) }
            }
          }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $shape = $presentation.Slides.Item($slideIndex).Shapes.AddPicture($imagePath, $false, $true, $left, $top, $width, $height)
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; shape = [string]$shape.Name; saved = $true }
          } finally { $presentation.Close() }
        }
        { $_ -in @('get_images', 'get_tables', 'get_charts') } {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try {
            $items = @()
            foreach ($slide in $presentation.Slides) {
              foreach ($shape in $slide.Shapes) {
                $include = $false
                if ($Action -eq 'get_images') { $include = ([int]$shape.Type -in @(11,13)) }
                elseif ($Action -eq 'get_tables') { try { $include = [bool]$shape.HasTable } catch { $include = $false } }
                else { try { $include = [bool]$shape.HasChart } catch { $include = $false } }
                if (-not $include) { continue }
                $entry = [ordered]@{ slide = [int]$slide.SlideIndex; shape = [string]$shape.Name; type = [int]$shape.Type; left = [double]$shape.Left; top = [double]$shape.Top; width = [double]$shape.Width; height = [double]$shape.Height }
                if ($Action -eq 'get_tables') { try { $entry.rows = [int]$shape.Table.Rows.Count; $entry.columns = [int]$shape.Table.Columns.Count } catch { } }
                if ($Action -eq 'get_charts') { try { $entry.chart_type = [int]$shape.Chart.ChartType; $entry.has_title = [bool]$shape.Chart.HasTitle } catch { } }
                $items += $entry
              }
            }
            return [ordered]@{ app = 'powerpoint'; action = $Action; items = $items }
          } finally { $presentation.Close() }
        }
        'add_table' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $options = Get-Field $Parameters 'parameters'
          $rows = [int](Get-Field $options 'rows'); $columns = [int](Get-Field $options 'columns')
          if ($rows -le 0 -or $columns -le 0) { throw 'parameters.rows and parameters.columns must be positive integers' }
          $left = [double](Get-Field $options 'left'); if ($left -eq 0) { $left = 48 }
          $top = [double](Get-Field $options 'top'); if ($top -eq 0) { $top = 120 }
          $width = [double](Get-Field $options 'width'); if ($width -le 0) { $width = 620 }
          $height = [double](Get-Field $options 'height'); if ($height -le 0) { $height = 280 }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $shape = $presentation.Slides.Item($slideIndex).Shapes.AddTable($rows, $columns, $left, $top, $width, $height)
            $values = Get-Field $options 'values'
            if ($null -ne $values) {
              $rowIndex = 0
              foreach ($rowValues in @($values)) {
                $rowIndex += 1; if ($rowIndex -gt $rows) { break }
                $columnIndex = 0
                foreach ($value in @($rowValues)) {
                  $columnIndex += 1; if ($columnIndex -gt $columns) { break }
                  $shape.Table.Cell($rowIndex, $columnIndex).Shape.TextFrame.TextRange.Text = [string]$value
                }
              }
            }
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; shape = [string]$shape.Name; rows = $rows; columns = $columns; saved = $true }
          } finally { $presentation.Close() }
        }
        'edit_table' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); $shapeId = Get-Field $Parameters 'shape'; if ($slideIndex -le 0 -or $null -eq $shapeId) { throw 'slide and shape are required' }
          $options = Get-Field $Parameters 'parameters'; $row = [int](Get-Field $options 'row'); $column = [int](Get-Field $options 'column')
          if ($row -le 0 -or $column -le 0) { throw 'parameters.row and parameters.column are required' }
          $text = [string](Get-Field $Parameters 'text')
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $slide = $presentation.Slides.Item($slideIndex); $shape = $null
            try { $shape = $slide.Shapes.Item([string]$shapeId) } catch { try { $shape = $slide.Shapes.Item([int]$shapeId) } catch { } }
            if ($null -eq $shape -or -not $shape.HasTable) { throw 'PowerPoint table shape was not found' }
            $shape.Table.Cell($row, $column).Shape.TextFrame.TextRange.Text = $text
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; shape = [string]$shape.Name; row = $row; column = $column; saved = $true }
          } finally { $presentation.Close() }
        }
        'add_chart' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $options = Get-Field $Parameters 'parameters'
          $chartType = [int](Get-Field $options 'chart_type'); if ($chartType -eq 0) { $chartType = 51 }
          $left = [double](Get-Field $options 'left'); if ($left -eq 0) { $left = 48 }
          $top = [double](Get-Field $options 'top'); if ($top -eq 0) { $top = 120 }
          $width = [double](Get-Field $options 'width'); if ($width -le 0) { $width = 620 }
          $height = [double](Get-Field $options 'height'); if ($height -le 0) { $height = 320 }
          # PowerPoint chart insertion requires an active presentation window on some Office 16 builds;
          # opening WithWindow=$false makes both AddChart2 and AddChart fail with E_FAIL.
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $true)
          try {
            $slide = $presentation.Slides.Item($slideIndex)
            $shape = $null
            try { $shape = $slide.Shapes.AddChart2(-1, $chartType, $left, $top, $width, $height, $true) }
            catch { $shape = $slide.Shapes.AddChart($chartType, $left, $top, $width, $height) }
            $title = [string](Get-Field $options 'title')
            if ($title.Length -gt 0) { $shape.Chart.HasTitle = $true; $shape.Chart.ChartTitle.Text = $title }
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; shape = [string]$shape.Name; chart_type = [int]$shape.Chart.ChartType; saved = $true }
          } finally { $presentation.Close() }
        }
        'edit_chart' {
          if ($filePath.Length -eq 0 -or -not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); $shapeId = Get-Field $Parameters 'shape'; if ($slideIndex -le 0 -or $null -eq $shapeId) { throw 'slide and shape are required' }
          $options = Get-Field $Parameters 'parameters'
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $slide = $presentation.Slides.Item($slideIndex); $shape = $null
            try { $shape = $slide.Shapes.Item([string]$shapeId) } catch { try { $shape = $slide.Shapes.Item([int]$shapeId) } catch { } }
            if ($null -eq $shape -or -not $shape.HasChart) { throw 'PowerPoint chart shape was not found' }
            $chartType = Get-Field $options 'chart_type'; if ($null -ne $chartType) { $shape.Chart.ChartType = [int]$chartType }
            $title = Get-Field $options 'title'; if ($null -ne $title) { $shape.Chart.HasTitle = $true; $shape.Chart.ChartTitle.Text = [string]$title }
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; shape = [string]$shape.Name; chart_type = [int]$shape.Chart.ChartType; saved = $true }
          } finally { $presentation.Close() }
        }
        'set_notes' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $slideIndex = [int](Get-Field $Parameters 'slide'); if ($slideIndex -le 0) { throw 'slide must be a positive integer' }
          $text = [string](Get-Field $Parameters 'text')
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try {
            $presentation.Slides.Item($slideIndex).NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text = $text
            $presentation.Save()
            return [ordered]@{ app = 'powerpoint'; action = $Action; slide = $slideIndex; saved = $true }
          } finally { $presentation.Close() }
        }
        'save' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $presentation = $powerpoint.Presentations.Open($filePath, $false, $false, $false)
          try { $presentation.Save(); return [ordered]@{ app = 'powerpoint'; action = $Action; file_path = $filePath; saved = $true } }
          finally { $presentation.Close() }
        }
        'save_as' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          if (-not (Test-Path $filePath -PathType Leaf)) { throw 'PowerPoint file was not found' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try {
            $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
            $presentation.SaveAs($target)
            return [ordered]@{ app = 'powerpoint'; action = 'save_as'; source = $filePath; target = $target; saved = $true }
          } finally { $presentation.Close() }
        }
        'export_pdf' {
          if ($filePath.Length -eq 0) { throw 'file_path is required' }
          $target = [string](Get-Field $Parameters 'target_path'); if ($target.Length -eq 0) { throw 'target_path is required' }
          $presentation = $powerpoint.Presentations.Open($filePath, $true, $false, $false)
          try { $presentation.SaveAs($target, 32); return [ordered]@{ app = 'powerpoint'; action = $Action; source = $filePath; target = $target; exported = $true } }
          finally { $presentation.Close() }
        }
        default { throw "Unsupported powerpoint action: $Action" }
      }
    } finally {
      if ($null -ne $powerpoint) { try { $powerpoint.Quit() } catch { }; Release-ComObject $powerpoint }
    }
  }
  if ($App -eq 'outlook') {
    # Outlook is a single-instance COM server, so never call Quit() here: doing
    # so can close the user's already-open Outlook window. Read and mutation
    # actions remain bounded by the semantic mutation/confirmation policy.
    $outlook = $null
    $namespace = $null
    try {
      $outlook = New-Object -ComObject Outlook.Application
      $namespace = $outlook.GetNamespace('MAPI')
      switch ($Action) {
        'list_folders' {
          $folders = @()
          foreach ($store in $namespace.Folders) {
            foreach ($folder in $store.Folders) {
              $folders += [ordered]@{
                store = [string]$store.Name
                name = [string]$folder.Name
                path = [string]$folder.FolderPath
                item_count = [int]$folder.Items.Count
              }
            }
          }
          return [ordered]@{ app = 'outlook'; action = 'list_folders'; folders = $folders }
        }
        'list_messages' {
          $folderPath = [string](Get-Field $Parameters 'folder')
          $maxMessages = [int](Get-Field $Parameters 'max_messages')
          if ($maxMessages -le 0) { $maxMessages = 20 }
          if ($maxMessages -gt 100) { $maxMessages = 100 }
          $folder = $null
          if ($folderPath.Length -eq 0) {
            $folder = $namespace.GetDefaultFolder(6)
          } else {
            $segments = @($folderPath.Trim('\').Split('\') | Where-Object { $_.Length -gt 0 })
            if ($segments.Count -ge 2) {
              try {
                $folder = $namespace.Folders.Item([string]$segments[0])
                for ($index = 1; $index -lt $segments.Count; $index += 1) {
                  $folder = $folder.Folders.Item([string]$segments[$index])
                }
              } catch { $folder = $null }
            }
            if ($null -eq $folder -and $segments.Count -eq 1) {
              foreach ($store in $namespace.Folders) {
                try { $folder = $store.Folders.Item([string]$segments[0]); if ($null -ne $folder) { break } } catch { }
              }
            }
            if ($null -eq $folder) { throw "Outlook folder was not found: $folderPath" }
          }
          $items = $folder.Items
          $items.Sort('[ReceivedTime]', $true)
          $messages = @()
          $count = 0
          foreach ($item in $items) {
            if ($count -ge $maxMessages) { break }
            $count += 1
            $messages += [ordered]@{
              subject = [string]$item.Subject
              sender = [string]$item.SenderName
              received = try { $item.ReceivedTime.ToString('o') } catch { '' }
            }
          }
          return [ordered]@{ app = 'outlook'; action = 'list_messages'; folder = if ($folderPath.Length -eq 0) { 'Inbox' } else { $folderPath }; messages = $messages }
        }
        { $_ -in @('get_message', 'get_headers', 'get_body', 'list_attachments', 'conversation') } {
          $messageId = [string](Get-Field $Parameters 'message_id'); if ($messageId.Length -eq 0) { throw 'message_id is required' }
          $item = $namespace.GetItemFromID($messageId)
          if ($null -eq $item) { throw 'Outlook message was not found' }
          $attachments = @()
          if ($Action -eq 'list_attachments' -or $Action -eq 'get_message') {
            foreach ($attachment in $item.Attachments) {
              $attachments += [ordered]@{ id = [string]$attachment.Index; name = [string]$attachment.FileName; size = [int64]$attachment.Size; type = [int]$attachment.Type }
            }
          }
          if ($Action -eq 'get_headers') {
            return [ordered]@{ app = 'outlook'; action = $Action; message_id = $messageId; subject = [string]$item.Subject; sender = [string]$item.SenderName; sender_email = try { [string]$item.SenderEmailAddress } catch { '' }; received = try { $item.ReceivedTime.ToString('o') } catch { '' }; sent = try { $item.SentOn.ToString('o') } catch { '' }; unread = try { [bool]$item.UnRead } catch { $false } }
          }
          if ($Action -eq 'get_body') {
            return [ordered]@{ app = 'outlook'; action = $Action; message_id = $messageId; body = [string]$item.Body; html_body = try { [string]$item.HTMLBody } catch { '' } }
          }
          if ($Action -eq 'conversation') {
            $conversation = try { $item.GetConversation() } catch { $null }
            return [ordered]@{ app = 'outlook'; action = $Action; message_id = $messageId; conversation_id = try { [string]$item.ConversationID } catch { '' }; available = $null -ne $conversation }
          }
          return [ordered]@{ app = 'outlook'; action = $Action; message_id = $messageId; subject = [string]$item.Subject; sender = [string]$item.SenderName; received = try { $item.ReceivedTime.ToString('o') } catch { '' }; unread = try { [bool]$item.UnRead } catch { $false }; body = [string]$item.Body; html_body = try { [string]$item.HTMLBody } catch { '' }; attachments = $attachments }
        }
        'search' {
          $query = [string](Get-Field $Parameters 'query'); if ($query.Length -eq 0) { throw 'query is required' }
          $folderPath = [string](Get-Field $Parameters 'folder')
          $maxMessages = [int](Get-Field $Parameters 'max_messages'); if ($maxMessages -le 0) { $maxMessages = 20 }; if ($maxMessages -gt 100) { $maxMessages = 100 }
          $folder = Resolve-OutlookFolder $namespace $folderPath 6
          $matches = @()
          foreach ($item in $folder.Items) {
            if ($matches.Count -ge $maxMessages) { break }
            $haystack = ([string]$item.Subject + ' ' + [string]$item.SenderName + ' ' + [string]$item.Body)
            if ($haystack.IndexOf($query, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            $matches += [ordered]@{ message_id = [string]$item.EntryID; subject = [string]$item.Subject; sender = [string]$item.SenderName; received = try { $item.ReceivedTime.ToString('o') } catch { '' }; unread = try { [bool]$item.UnRead } catch { $false } }
          }
          return [ordered]@{ app = 'outlook'; action = $Action; query = $query; matches = $matches }
        }
        { $_ -in @('get_state', 'mailbox_status') } {
          $inbox = $namespace.GetDefaultFolder(6)
          return [ordered]@{ app = 'outlook'; action = $Action; current_user = try { [string]$namespace.CurrentUser.Name } catch { '' }; inbox_count = [int]$inbox.Items.Count; offline = try { [bool]$namespace.Offline } catch { $false } }
        }
        'save_attachment' {
          $messageId = [string](Get-Field $Parameters 'message_id'); $attachmentId = [int](Get-Field $Parameters 'attachment_id'); $target = [string](Get-Field $Parameters 'target_path')
          if ($messageId.Length -eq 0 -or $attachmentId -le 0 -or $target.Length -eq 0) { throw 'message_id, attachment_id and target_path are required' }
          $item = $namespace.GetItemFromID($messageId)
          $attachment = $item.Attachments.Item($attachmentId)
          $attachment.SaveAsFile($target)
          return [ordered]@{ app = 'outlook'; action = $Action; message_id = $messageId; attachment_id = $attachmentId; target = $target; saved = $true }
        }
        'create_draft' {
          $mail = $outlook.CreateItem(0)
          $mail.Subject = [string](Get-Field $Parameters 'subject')
          $html = [string](Get-Field $Parameters 'body_html')
          if ($html.Length -gt 0) { $mail.HTMLBody = $html } else { $mail.Body = [string](Get-Field $Parameters 'body') }
          Add-OutlookRecipients $mail (Get-Field $Parameters 'to') 1
          Add-OutlookRecipients $mail (Get-Field $Parameters 'cc') 2
          Add-OutlookRecipients $mail (Get-Field $Parameters 'bcc') 3
          foreach ($attachmentPath in @(Get-Field $Parameters 'attachments')) {
            if ([string]$attachmentPath -ne '') { [void]$mail.Attachments.Add([string]$attachmentPath) }
          }
          $mail.Save()
          return [ordered]@{ app = 'outlook'; action = $Action; draft_id = [string]$mail.EntryID; subject = [string]$mail.Subject; saved = $true; sent = $false }
        }
        { $_ -in @('update_draft', 'add_recipients', 'remove_recipients', 'attach_file', 'detach_file', 'set_importance', 'set_category', 'set_flag') } {
          $draftId = [string](Get-Field $Parameters 'draft_id'); if ($draftId.Length -eq 0) { throw 'draft_id is required' }
          $mail = $namespace.GetItemFromID($draftId); if ($null -eq $mail) { throw 'Outlook draft was not found' }
          if ($Action -eq 'update_draft') {
            $subject = Get-Field $Parameters 'subject'; if ($null -ne $subject) { $mail.Subject = [string]$subject }
            $html = Get-Field $Parameters 'body_html'; $body = Get-Field $Parameters 'body'
            if ($null -ne $html) { $mail.HTMLBody = [string]$html } elseif ($null -ne $body) { $mail.Body = [string]$body }
          }
          if ($Action -eq 'add_recipients') { Add-OutlookRecipients $mail (Get-Field $Parameters 'recipients') 1 }
          if ($Action -eq 'remove_recipients') {
            $targets = @((Get-Field $Parameters 'recipients') | ForEach-Object { ([string]$_).ToLowerInvariant() })
            for ($index = [int]$mail.Recipients.Count; $index -ge 1; $index -= 1) {
              $recipient = $mail.Recipients.Item($index)
              $address = ([string]$recipient.Address).ToLowerInvariant()
              $name = ([string]$recipient.Name).ToLowerInvariant()
              if ($targets -contains $address -or $targets -contains $name) { $recipient.Delete() }
            }
          }
          if ($Action -eq 'attach_file') {
            foreach ($attachmentPath in @(Get-Field $Parameters 'attachments')) { if ([string]$attachmentPath -ne '') { [void]$mail.Attachments.Add([string]$attachmentPath) } }
          }
          if ($Action -eq 'detach_file') {
            $attachmentId = [int](Get-Field $Parameters 'attachment_id'); if ($attachmentId -le 0) { throw 'attachment_id is required' }
            $mail.Attachments.Item($attachmentId).Delete()
          }
          if ($Action -eq 'set_importance') {
            $value = [string](Get-Field (Get-Field $Parameters 'parameters') 'importance')
            $mail.Importance = if ($value -eq 'high') { 2 } elseif ($value -eq 'low') { 0 } else { 1 }
          }
          if ($Action -eq 'set_category') { $mail.Categories = (@(Get-Field $Parameters 'categories') -join ', ') }
          if ($Action -eq 'set_flag') {
            $flag = [string](Get-Field (Get-Field $Parameters 'parameters') 'flag')
            if ($flag.Length -gt 0) { $mail.FlagRequest = $flag }
          }
          $mail.Save()
          return [ordered]@{ app = 'outlook'; action = $Action; draft_id = [string]$mail.EntryID; saved = $true; sent = $false }
        }
        { $_ -in @('mark_read', 'mark_unread') } {
          $messageId = [string](Get-Field $Parameters 'message_id'); if ($messageId.Length -eq 0) { throw 'message_id is required' }
          $item = $namespace.GetItemFromID($messageId)
          $item.UnRead = ($Action -eq 'mark_unread')
          $item.Save()
          return [ordered]@{ app = 'outlook'; action = $Action; message_id = $messageId; unread = [bool]$item.UnRead }
        }
        { $_ -in @('move_message', 'copy_message') } {
          $messageId = [string](Get-Field $Parameters 'message_id'); $targetFolder = [string](Get-Field $Parameters 'target_folder')
          if ($messageId.Length -eq 0 -or $targetFolder.Length -eq 0) { throw 'message_id and target_folder are required' }
          $item = $namespace.GetItemFromID($messageId)
          $folder = Resolve-OutlookFolder $namespace $targetFolder 6
          $moved = if ($Action -eq 'move_message') { $item.Move($folder) } else { $item.Copy().Move($folder) }
          return [ordered]@{ app = 'outlook'; action = $Action; message_id = [string]$moved.EntryID; target_folder = $targetFolder }
        }
        'send' {
          $draftId = [string](Get-Field $Parameters 'draft_id'); if ($draftId.Length -eq 0) { throw 'draft_id is required' }
          $mail = $namespace.GetItemFromID($draftId)
          $subject = [string]$mail.Subject
          $mail.Send()
          return [ordered]@{ app = 'outlook'; action = $Action; draft_id = $draftId; subject = $subject; sent = $true }
        }
        'delete' {
          $messageId = [string](Get-Field $Parameters 'message_id'); if ($messageId.Length -eq 0) { $messageId = [string](Get-Field $Parameters 'draft_id') }
          if ($messageId.Length -eq 0) { throw 'message_id or draft_id is required' }
          $item = $namespace.GetItemFromID($messageId)
          $item.Delete()
          return [ordered]@{ app = 'outlook'; action = $Action; message_id = $messageId; deleted = $true; permanent = $false }
        }
        'list_calendars' {
          $calendar = $namespace.GetDefaultFolder(9)
          return [ordered]@{ app = 'outlook'; action = $Action; calendars = @([ordered]@{ id = [string]$calendar.EntryID; name = [string]$calendar.Name; path = [string]$calendar.FolderPath; item_count = [int]$calendar.Items.Count }) }
        }
        { $_ -in @('get_events', 'search_events') } {
          $calendarPath = [string](Get-Field $Parameters 'calendar')
          $calendar = Resolve-OutlookFolder $namespace $calendarPath 9
          $maxResults = [int](Get-Field $Parameters 'max_results'); if ($maxResults -le 0) { $maxResults = 50 }; if ($maxResults -gt 200) { $maxResults = 200 }
          $query = [string](Get-Field $Parameters 'query')
          $items = $calendar.Items
          $items.Sort('[Start]')
          $items.IncludeRecurrences = $true
          $events = @()
          foreach ($event in $items) {
            if ($events.Count -ge $maxResults) { break }
            if ($Action -eq 'search_events' -and $query.Length -gt 0) {
              $haystack = ([string]$event.Subject + ' ' + [string]$event.Location + ' ' + [string]$event.Body)
              if ($haystack.IndexOf($query, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            }
            $events += [ordered]@{ event_id = [string]$event.EntryID; subject = [string]$event.Subject; start = try { $event.Start.ToString('o') } catch { '' }; end = try { $event.End.ToString('o') } catch { '' }; location = try { [string]$event.Location } catch { '' }; all_day = try { [bool]$event.AllDayEvent } catch { $false } }
          }
          return [ordered]@{ app = 'outlook'; action = $Action; events = $events }
        }
        'get_event' {
          $eventId = [string](Get-Field $Parameters 'event_id'); if ($eventId.Length -eq 0) { throw 'event_id is required' }
          $event = $namespace.GetItemFromID($eventId)
          return [ordered]@{ app = 'outlook'; action = $Action; event_id = $eventId; subject = [string]$event.Subject; body = [string]$event.Body; start = try { $event.Start.ToString('o') } catch { '' }; end = try { $event.End.ToString('o') } catch { '' }; location = try { [string]$event.Location } catch { '' }; reminder_set = try { [bool]$event.ReminderSet } catch { $false } }
        }
        { $_ -in @('create_event', 'update_event') } {
          if ($Action -eq 'create_event') { $event = $outlook.CreateItem(1) } else {
            $eventId = [string](Get-Field $Parameters 'event_id'); if ($eventId.Length -eq 0) { throw 'event_id is required' }
            $event = $namespace.GetItemFromID($eventId)
          }
          $subject = Get-Field $Parameters 'subject'; if ($null -ne $subject) { $event.Subject = [string]$subject }
          $body = Get-Field $Parameters 'body'; if ($null -ne $body) { $event.Body = [string]$body }
          $start = Get-Field $Parameters 'start'; if ($null -ne $start) { $event.Start = [datetime]::Parse([string]$start) }
          $end = Get-Field $Parameters 'end'; if ($null -ne $end) { $event.End = [datetime]::Parse([string]$end) }
          $options = Get-Field $Parameters 'parameters'
          if ($null -ne $options) {
            $location = Get-Field $options 'location'; if ($null -ne $location) { $event.Location = [string]$location }
            $reminder = Get-Field $options 'reminder_minutes'; if ($null -ne $reminder) { $event.ReminderSet = $true; $event.ReminderMinutesBeforeStart = [int]$reminder }
          }
          foreach ($address in @(Get-Field $Parameters 'attendees')) {
            if ([string]$address -ne '') { $recipient = $event.Recipients.Add([string]$address); $recipient.Type = 1; [void]$recipient.Resolve() }
          }
          $event.Save()
          return [ordered]@{ app = 'outlook'; action = $Action; event_id = [string]$event.EntryID; subject = [string]$event.Subject; saved = $true; sent = $false }
        }
        'delete_event' {
          $eventId = [string](Get-Field $Parameters 'event_id'); if ($eventId.Length -eq 0) { throw 'event_id is required' }
          $event = $namespace.GetItemFromID($eventId)
          $event.Delete()
          return [ordered]@{ app = 'outlook'; action = $Action; event_id = $eventId; deleted = $true }
        }
        'send_invite' {
          $eventId = [string](Get-Field $Parameters 'event_id'); if ($eventId.Length -eq 0) { throw 'event_id is required' }
          $event = $namespace.GetItemFromID($eventId)
          $event.MeetingStatus = 1
          $event.Send()
          return [ordered]@{ app = 'outlook'; action = $Action; event_id = $eventId; sent = $true }
        }
        'list_contacts' {
          $folder = $namespace.GetDefaultFolder(10)
          $maxResults = [int](Get-Field $Parameters 'max_results'); if ($maxResults -le 0) { $maxResults = 100 }; if ($maxResults -gt 500) { $maxResults = 500 }
          $contacts = @()
          foreach ($contact in $folder.Items) {
            if ($contacts.Count -ge $maxResults) { break }
            $contacts += [ordered]@{ contact_id = [string]$contact.EntryID; name = [string]$contact.FullName; email = try { [string]$contact.Email1Address } catch { '' }; company = try { [string]$contact.CompanyName } catch { '' }; title = try { [string]$contact.JobTitle } catch { '' } }
          }
          return [ordered]@{ app = 'outlook'; action = $Action; contacts = $contacts }
        }
        'search_contacts' {
          $query = [string](Get-Field $Parameters 'query'); if ($query.Length -eq 0) { throw 'query is required' }
          $folder = $namespace.GetDefaultFolder(10)
          $maxResults = [int](Get-Field $Parameters 'max_results'); if ($maxResults -le 0) { $maxResults = 100 }; if ($maxResults -gt 500) { $maxResults = 500 }
          $contacts = @()
          foreach ($contact in $folder.Items) {
            if ($contacts.Count -ge $maxResults) { break }
            $haystack = ([string]$contact.FullName + ' ' + [string]$contact.Email1Address + ' ' + [string]$contact.CompanyName)
            if ($haystack.IndexOf($query, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            $contacts += [ordered]@{ contact_id = [string]$contact.EntryID; name = [string]$contact.FullName; email = try { [string]$contact.Email1Address } catch { '' }; company = try { [string]$contact.CompanyName } catch { '' } }
          }
          return [ordered]@{ app = 'outlook'; action = $Action; contacts = $contacts }
        }
        'get_contact' {
          $contactId = [string](Get-Field $Parameters 'contact_id'); if ($contactId.Length -eq 0) { throw 'contact_id is required' }
          $contact = $namespace.GetItemFromID($contactId)
          return [ordered]@{ app = 'outlook'; action = $Action; contact_id = $contactId; name = [string]$contact.FullName; email = try { [string]$contact.Email1Address } catch { '' }; company = try { [string]$contact.CompanyName } catch { '' }; title = try { [string]$contact.JobTitle } catch { '' }; business_phone = try { [string]$contact.BusinessTelephoneNumber } catch { '' }; mobile_phone = try { [string]$contact.MobileTelephoneNumber } catch { '' } }
        }
        { $_ -in @('create_contact', 'update_contact') } {
          if ($Action -eq 'create_contact') { $contact = $outlook.CreateItem(2) } else {
            $contactId = [string](Get-Field $Parameters 'contact_id'); if ($contactId.Length -eq 0) { throw 'contact_id is required' }
            $contact = $namespace.GetItemFromID($contactId)
          }
          $name = Get-Field $Parameters 'name'; if ($null -ne $name) { $contact.FullName = [string]$name }
          $email = Get-Field $Parameters 'email'; if ($null -ne $email) { $contact.Email1Address = [string]$email }
          $company = Get-Field $Parameters 'company'; if ($null -ne $company) { $contact.CompanyName = [string]$company }
          $title = Get-Field $Parameters 'title'; if ($null -ne $title) { $contact.JobTitle = [string]$title }
          $phones = Get-Field $Parameters 'phones'
          if ($null -ne $phones) {
            $business = Get-Field $phones 'business'; if ($null -ne $business) { $contact.BusinessTelephoneNumber = [string]$business }
            $mobile = Get-Field $phones 'mobile'; if ($null -ne $mobile) { $contact.MobileTelephoneNumber = [string]$mobile }
          }
          $contact.Save()
          return [ordered]@{ app = 'outlook'; action = $Action; contact_id = [string]$contact.EntryID; saved = $true }
        }
        'delete_contact' {
          $contactId = [string](Get-Field $Parameters 'contact_id'); if ($contactId.Length -eq 0) { throw 'contact_id is required' }
          $contact = $namespace.GetItemFromID($contactId)
          $contact.Delete()
          return [ordered]@{ app = 'outlook'; action = $Action; contact_id = $contactId; deleted = $true }
        }
        'list_task_folders' {
          $folder = $namespace.GetDefaultFolder(13)
          return [ordered]@{ app = 'outlook'; action = $Action; folders = @([ordered]@{ id = [string]$folder.EntryID; name = [string]$folder.Name; path = [string]$folder.FolderPath; item_count = [int]$folder.Items.Count }) }
        }
        { $_ -in @('list_tasks', 'search_tasks') } {
          $folderPath = [string](Get-Field $Parameters 'folder')
          $folder = Resolve-OutlookFolder $namespace $folderPath 13
          $query = [string](Get-Field $Parameters 'query')
          $maxResults = [int](Get-Field $Parameters 'max_results'); if ($maxResults -le 0) { $maxResults = 100 }; if ($maxResults -gt 500) { $maxResults = 500 }
          $tasks = @()
          foreach ($task in $folder.Items) {
            if ($tasks.Count -ge $maxResults) { break }
            if ($Action -eq 'search_tasks' -and $query.Length -gt 0) {
              $haystack = ([string]$task.Subject + ' ' + [string]$task.Body)
              if ($haystack.IndexOf($query, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
            }
            $tasks += [ordered]@{ task_id = [string]$task.EntryID; subject = [string]$task.Subject; due = try { $task.DueDate.ToString('o') } catch { '' }; status = try { [int]$task.Status } catch { -1 }; complete = try { [bool]$task.Complete } catch { $false } }
          }
          return [ordered]@{ app = 'outlook'; action = $Action; tasks = $tasks }
        }
        'get_task' {
          $taskId = [string](Get-Field $Parameters 'task_id'); if ($taskId.Length -eq 0) { throw 'task_id is required' }
          $task = $namespace.GetItemFromID($taskId)
          return [ordered]@{ app = 'outlook'; action = $Action; task_id = $taskId; subject = [string]$task.Subject; body = [string]$task.Body; due = try { $task.DueDate.ToString('o') } catch { '' }; status = try { [int]$task.Status } catch { -1 }; complete = try { [bool]$task.Complete } catch { $false } }
        }
        { $_ -in @('create_task', 'update_task') } {
          if ($Action -eq 'create_task') { $task = $outlook.CreateItem(3) } else {
            $taskId = [string](Get-Field $Parameters 'task_id'); if ($taskId.Length -eq 0) { throw 'task_id is required' }
            $task = $namespace.GetItemFromID($taskId)
          }
          $subject = Get-Field $Parameters 'subject'; if ($null -ne $subject) { $task.Subject = [string]$subject }
          $body = Get-Field $Parameters 'body'; if ($null -ne $body) { $task.Body = [string]$body }
          $due = Get-Field $Parameters 'due'; if ($null -ne $due) { $task.DueDate = [datetime]::Parse([string]$due) }
          $task.Save()
          return [ordered]@{ app = 'outlook'; action = $Action; task_id = [string]$task.EntryID; saved = $true }
        }
        { $_ -in @('complete_task', 'reopen_task') } {
          $taskId = [string](Get-Field $Parameters 'task_id'); if ($taskId.Length -eq 0) { throw 'task_id is required' }
          $task = $namespace.GetItemFromID($taskId)
          if ($Action -eq 'complete_task') { $task.MarkComplete() } else { $task.Status = 0; $task.PercentComplete = 0; $task.Complete = $false; $task.Save() }
          return [ordered]@{ app = 'outlook'; action = $Action; task_id = $taskId; complete = [bool]$task.Complete }
        }
        'delete_task' {
          $taskId = [string](Get-Field $Parameters 'task_id'); if ($taskId.Length -eq 0) { throw 'task_id is required' }
          $task = $namespace.GetItemFromID($taskId)
          $task.Delete()
          return [ordered]@{ app = 'outlook'; action = $Action; task_id = $taskId; deleted = $true }
        }
        default { throw "Unsupported outlook action: $Action" }
      }
    } finally {
      if ($null -ne $namespace) { Release-ComObject $namespace }
      if ($null -ne $outlook) { Release-ComObject $outlook }
    }
  }
  throw "Unsupported office app: $App"
}

try {
  $raw = ($input | Out-String).Trim()
  $request = $raw | ConvertFrom-Json
  $capability = [string](Get-Field $request 'capability')
  $payload = Get-Field $request 'input'
  $parameters = Get-Field $payload 'parameters'; if ($null -eq $parameters) { $parameters = $payload }
  $value = switch ($capability) {
    'window' { Invoke-WindowAction ([string](Get-Field $payload 'operation')) $parameters }
    'accessibility' { Invoke-AccessibilityAction ([string](Get-Field $payload 'action')) $parameters }
    'input_event' { Invoke-InputAction ([string](Get-Field $payload 'operation')) $parameters }
    'vision' { Invoke-VisionAction ([string](Get-Field $payload 'action')) $payload }
    'system_info' { Invoke-SystemInfoAction ([string](Get-Field $payload 'operation')) $parameters }
    'notification' { Invoke-NotificationAction ([string](Get-Field $payload 'action')) $parameters }
    'file_dialog' { Invoke-FileDialogAction ([string](Get-Field $payload 'action')) $parameters }
    'clipboard' { Invoke-ClipboardAction ([string](Get-Field $payload 'action')) $parameters }
    'audio' { Invoke-AudioAction ([string](Get-Field $payload 'action')) $parameters }
    'screen_record' { Invoke-ScreenRecordAction ([string](Get-Field $payload 'action')) $parameters }
    'office' { Invoke-OfficeAction ([string](Get-Field $payload 'app')) ([string](Get-Field $payload 'action')) $payload }
    default { throw 'Unsupported Windows capability' }
  }
  $result = Success $value
  Write-Output ($result | ConvertTo-Json -Compress -Depth 50)
} catch {
  $failureCode = 'INTERNAL_ERROR'
  $failureRecoverable = $true
  $failureMessage = 'Windows native capability failed'
  try {
    $detail = [string]$_.Exception.Message
    if (-not [string]::IsNullOrWhiteSpace($detail)) {
      $detail = ($detail -replace '[\r\n]+', ' ').Trim()
      if ($detail.Length -gt 1000) { $detail = $detail.Substring(0, 1000) }
      if ($detail -eq 'Window not found') {
        $failureCode = 'FILE_NOT_FOUND'
        $failureMessage = $detail
      } elseif (
        $detail -eq 'Window index is out of range' -or
        $detail -eq 'Window is minimized; restore it before capture' -or
        $detail -eq 'Window is not visible; activate or restore it before capture'
      ) {
        $failureCode = 'INVALID_INPUT'
        $failureRecoverable = $false
        $failureMessage = $detail
      } else {
        $failureMessage = $failureMessage + ': ' + $detail
      }
    }
  } catch { }
  Write-Output ((Failure $failureCode $failureMessage $failureRecoverable) | ConvertTo-Json -Compress -Depth 50)
}
