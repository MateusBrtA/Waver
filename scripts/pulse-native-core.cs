using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace PulseCordNative {
  internal static class Win32Input {
    public const uint INPUT_MOUSE = 0;
    public const uint INPUT_KEYBOARD = 1;

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_XDOWN = 0x0080;
    public const uint MOUSEEVENTF_XUP = 0x0100;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;

    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_SCANCODE = 0x0008;

    public const uint MAPVK_VK_TO_VSC = 0;
    public const uint TH32CS_SNAPPROCESS = 0x00000002;

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
      public uint type;
      public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
      [FieldOffset(0)] public MOUSEINPUT mi;
      [FieldOffset(0)] public KEYBDINPUT ki;
      [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
      public int dx;
      public int dy;
      public int mouseData;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
      public ushort wVk;
      public ushort wScan;
      public uint dwFlags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
      public uint uMsg;
      public ushort wParamL;
      public ushort wParamH;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PROCESSENTRY32W {
      public uint dwSize;
      public uint cntUsage;
      public uint th32ProcessID;
      public IntPtr th32DefaultHeapID;
      public uint th32ModuleID;
      public uint cntThreads;
      public uint th32ParentProcessID;
      public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
      public string szExeFile;
    }

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetDllDirectory(string lpPathName);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
  }

  internal static class ViGEmNative {
    public const uint VIGEM_ERROR_NONE = 0x20000000;

    [StructLayout(LayoutKind.Sequential)]
    public struct XUSB_REPORT {
      public ushort wButtons;
      public byte bLeftTrigger;
      public byte bRightTrigger;
      public short sThumbLX;
      public short sThumbLY;
      public short sThumbRX;
      public short sThumbRY;
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate void X360NotificationDelegate(
      IntPtr client,
      IntPtr target,
      byte largeMotor,
      byte smallMotor,
      byte ledNumber,
      IntPtr userData
    );

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern IntPtr vigem_alloc();

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern void vigem_free(IntPtr vigem);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern uint vigem_connect(IntPtr vigem);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern void vigem_disconnect(IntPtr vigem);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern IntPtr vigem_target_x360_alloc();

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern void vigem_target_free(IntPtr target);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern uint vigem_target_add(IntPtr vigem, IntPtr target);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern uint vigem_target_remove(IntPtr vigem, IntPtr target);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern uint vigem_target_x360_update(IntPtr vigem, IntPtr target, ref XUSB_REPORT report);

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern uint vigem_target_x360_register_notification(
      IntPtr vigem,
      IntPtr target,
      X360NotificationDelegate notification,
      IntPtr userData
    );

    [DllImport("ViGEmClient.dll", CallingConvention = CallingConvention.Winapi)]
    public static extern void vigem_target_x360_unregister_notification(IntPtr target);
  }

  /// <summary>
  /// Prioridade do host (modo Parsec): hooks de baixo nível detectam mouse/teclado FÍSICOS do host
  /// (ignora eventos injetados via SendInput, que têm a flag INJECTED). Enquanto o host mexe,
  /// o input remoto é bloqueado; após IdleMs sem input físico, o controle volta para quem está conectado.
  /// O callback do hook só grava um timestamp (rápido, para o Windows não remover o hook).
  /// </summary>
  internal static class HostPresence {
    private delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
      public IntPtr hwnd;
      public uint message;
      public IntPtr wParam;
      public IntPtr lParam;
      public uint time;
      public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT {
      public POINT pt;
      public uint mouseData;
      public uint flags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT {
      public uint vkCode;
      public uint scanCode;
      public uint flags;
      public uint time;
      public UIntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const uint LLMHF_INJECTED = 0x01;
    private const uint LLKHF_INJECTED = 0x10;
    private const uint WM_QUIT = 0x0012;

    private static LowLevelProc mouseProc;
    private static LowLevelProc keyboardProc;
    private static System.Threading.Thread hookThread;
    private static uint hookThreadId;
    private static System.Threading.Timer idleTimer;
    private static readonly System.Diagnostics.Stopwatch Clock = System.Diagnostics.Stopwatch.StartNew();
    private static long lastPhysicalMs = -100000;
    private static volatile bool active;
    private static volatile bool running;

    public static int IdleMs = 1500;
    public static bool Active { get { return running && active; } }
    public static Action<bool> OnChange;

    private static void MarkPhysical() {
      System.Threading.Interlocked.Exchange(ref lastPhysicalMs, Clock.ElapsedMilliseconds);
    }

    private static IntPtr MouseHook(int nCode, IntPtr wParam, IntPtr lParam) {
      if (nCode >= 0) {
        MSLLHOOKSTRUCT s = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
        if ((s.flags & LLMHF_INJECTED) == 0) MarkPhysical();
      }
      return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static IntPtr KeyboardHook(int nCode, IntPtr wParam, IntPtr lParam) {
      if (nCode >= 0) {
        KBDLLHOOKSTRUCT s = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        if ((s.flags & LLKHF_INJECTED) == 0) MarkPhysical();
      }
      return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static void HookLoop() {
      hookThreadId = GetCurrentThreadId();
      mouseProc = MouseHook;
      keyboardProc = KeyboardHook;
      IntPtr hMod = GetModuleHandle(null);
      IntPtr mh = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, hMod, 0);
      IntPtr kh = SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, hMod, 0);
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
      if (mh != IntPtr.Zero) UnhookWindowsHookEx(mh);
      if (kh != IntPtr.Zero) UnhookWindowsHookEx(kh);
    }

    private static void Tick(object _) {
      if (!running) return;
      long since = Clock.ElapsedMilliseconds - System.Threading.Interlocked.Read(ref lastPhysicalMs);
      bool nowActive = since < IdleMs;
      if (nowActive != active) {
        active = nowActive;
        Action<bool> cb = OnChange;
        if (cb != null) cb(nowActive);
      }
    }

    public static void Start() {
      if (running) return;
      running = true;
      active = false;
      lastPhysicalMs = -100000;
      hookThread = new System.Threading.Thread(HookLoop);
      hookThread.IsBackground = true;
      hookThread.Start();
      idleTimer = new System.Threading.Timer(Tick, null, 100, 100);
    }

    public static void Stop() {
      if (!running) return;
      running = false;
      if (idleTimer != null) {
        idleTimer.Dispose();
        idleTimer = null;
      }
      if (hookThreadId != 0) PostThreadMessage(hookThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
      hookThreadId = 0;
      if (active) {
        active = false;
        Action<bool> cb = OnChange;
        if (cb != null) cb(false);
      }
    }
  }

  internal sealed class Program {
    private static readonly object StdoutLock = new object();
    // Marca nossos eventos injetados (além da flag INJECTED do Windows)
    private static readonly UIntPtr PulseMarker = new UIntPtr(0x50554C53u);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    // Move o cursor via SendInput (absoluto na área virtual de todos os monitores).
    // SetCursorPos não é marcado como "injetado", então confundiria a detecção de input do host.
    private static void SendMouseAbsolute(int x, int y) {
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
      int vw = Math.Max(1, GetSystemMetrics(78)), vh = Math.Max(1, GetSystemMetrics(79));
      Win32Input.INPUT inp = new Win32Input.INPUT();
      inp.type = Win32Input.INPUT_MOUSE;
      inp.U.mi.dx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
      inp.U.mi.dy = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
      inp.U.mi.dwFlags = Win32Input.MOUSEEVENTF_MOVE | 0x8000u /*ABSOLUTE*/ | 0x4000u /*VIRTUALDESK*/;
      inp.U.mi.dwExtraInfo = PulseMarker;
      Win32Input.SendInput(1, new[] { inp }, InputSize);
    }
    private static readonly HashSet<int> HeldKeys = new HashSet<int>();
    private static readonly HashSet<int> HeldMouseButtons = new HashSet<int>();
    private static readonly HashSet<int> HeldFallbackKeys = new HashSet<int>();
    private static readonly HashSet<int> HeldFallbackMouseButtons = new HashSet<int>();
    private static readonly int InputSize = Marshal.SizeOf(typeof(Win32Input.INPUT));

    private static bool dllPresent = false;
    private static string vigemState = "NO_DLL";
    private static IntPtr vigemClient = IntPtr.Zero;
    private static readonly IntPtr[] PadTargets = new IntPtr[4];
    private static readonly ViGEmNative.X360NotificationDelegate[] PadCallbacks = new ViGEmNative.X360NotificationDelegate[4];

    private static void WriteLineSafe(string line) {
      lock (StdoutLock) {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
      }
    }

    private static bool IsExtendedKey(int vk) {
      return (vk >= 0x21 && vk <= 0x28) || // PageUp..Down
             vk == 0x2C || vk == 0x2D || vk == 0x2E || // PrintScreen, Insert, Delete
             vk == 0x5B || vk == 0x5C || vk == 0x5D || // LWin, RWin, Apps
             vk == 0x6F || vk == 0x90 || // NumpadDivide, NumLock
             vk == 0xA3 || vk == 0xA5;   // RCtrl, RAlt
    }

    private static void SendKey(int vk, bool down) {
      if (vk <= 0 || vk > 255) return;
      if (down) HeldKeys.Add(vk);
      else HeldKeys.Remove(vk);

      uint scan = Win32Input.MapVirtualKey((uint)vk, Win32Input.MAPVK_VK_TO_VSC);
      Win32Input.INPUT inp = new Win32Input.INPUT();
      inp.type = Win32Input.INPUT_KEYBOARD;
      if (scan != 0) {
        uint flags = Win32Input.KEYEVENTF_SCANCODE;
        if (IsExtendedKey(vk)) flags |= Win32Input.KEYEVENTF_EXTENDEDKEY;
        if (!down) flags |= Win32Input.KEYEVENTF_KEYUP;
        inp.U.ki.wVk = 0;
        inp.U.ki.wScan = (ushort)scan;
        inp.U.ki.dwFlags = flags;
      } else {
        uint flags = down ? 0u : Win32Input.KEYEVENTF_KEYUP;
        if (IsExtendedKey(vk)) flags |= Win32Input.KEYEVENTF_EXTENDEDKEY;
        inp.U.ki.wVk = (ushort)vk;
        inp.U.ki.wScan = 0;
        inp.U.ki.dwFlags = flags;
      }
      inp.U.ki.dwExtraInfo = PulseMarker;
      Win32Input.SendInput(1, new[] { inp }, InputSize);
    }

    private static void SendMouseMoveRel(int dx, int dy) {
      if (dx == 0 && dy == 0) return;
      Win32Input.INPUT inp = new Win32Input.INPUT();
      inp.type = Win32Input.INPUT_MOUSE;
      inp.U.mi.dx = dx;
      inp.U.mi.dy = dy;
      inp.U.mi.dwFlags = Win32Input.MOUSEEVENTF_MOVE;
      inp.U.mi.dwExtraInfo = PulseMarker;
      Win32Input.SendInput(1, new[] { inp }, InputSize);
    }

    private static void SendMouseButton(int btn, bool down) {
      if (down) HeldMouseButtons.Add(btn);
      else HeldMouseButtons.Remove(btn);

      Win32Input.INPUT inp = new Win32Input.INPUT();
      inp.type = Win32Input.INPUT_MOUSE;
      if (btn == 0) {
        inp.U.mi.dwFlags = down ? Win32Input.MOUSEEVENTF_LEFTDOWN : Win32Input.MOUSEEVENTF_LEFTUP;
      } else if (btn == 1) {
        inp.U.mi.dwFlags = down ? Win32Input.MOUSEEVENTF_MIDDLEDOWN : Win32Input.MOUSEEVENTF_MIDDLEUP;
      } else if (btn == 2) {
        inp.U.mi.dwFlags = down ? Win32Input.MOUSEEVENTF_RIGHTDOWN : Win32Input.MOUSEEVENTF_RIGHTUP;
      } else if (btn == 3 || btn == 4) {
        inp.U.mi.mouseData = btn == 3 ? 1 : 2;
        inp.U.mi.dwFlags = down ? Win32Input.MOUSEEVENTF_XDOWN : Win32Input.MOUSEEVENTF_XUP;
      } else {
        return;
      }
      inp.U.mi.dwExtraInfo = PulseMarker;
      Win32Input.SendInput(1, new[] { inp }, InputSize);
    }

    private static void SendWheel(int delta) {
      if (delta == 0) return;
      Win32Input.INPUT inp = new Win32Input.INPUT();
      inp.type = Win32Input.INPUT_MOUSE;
      inp.U.mi.mouseData = delta;
      inp.U.mi.dwFlags = Win32Input.MOUSEEVENTF_WHEEL;
      inp.U.mi.dwExtraInfo = PulseMarker;
      Win32Input.SendInput(1, new[] { inp }, InputSize);
    }

    private static string InitViGEm() {
      string baseDir = AppDomain.CurrentDomain.BaseDirectory;
      Win32Input.SetDllDirectory(baseDir);
      string localDll = Path.Combine(baseDir, "ViGEmClient.dll");
      IntPtr loaded = IntPtr.Zero;
      if (File.Exists(localDll)) {
        loaded = Win32Input.LoadLibrary(localDll);
      }
      if (loaded == IntPtr.Zero) {
        loaded = Win32Input.LoadLibrary("ViGEmClient.dll");
      }
      dllPresent = loaded != IntPtr.Zero;
      if (!dllPresent) {
        vigemState = "NO_DLL";
        return vigemState;
      }

      try {
        if (vigemClient == IntPtr.Zero) {
          vigemClient = ViGEmNative.vigem_alloc();
        }
        if (vigemClient == IntPtr.Zero) {
          vigemState = "NO_DRIVER";
          return vigemState;
        }
        uint err = ViGEmNative.vigem_connect(vigemClient);
        if (err == ViGEmNative.VIGEM_ERROR_NONE) {
          vigemState = "OK";
        } else {
          vigemState = "NO_DRIVER";
        }
      } catch {
        vigemState = "NO_DLL";
      }
      return vigemState;
    }

    private static bool EnsureGamepadSlot(int slot) {
      if (slot < 0 || slot >= 4 || vigemState != "OK" || vigemClient == IntPtr.Zero) return false;
      if (PadTargets[slot] != IntPtr.Zero) return true;
      try {
        IntPtr target = ViGEmNative.vigem_target_x360_alloc();
        if (target == IntPtr.Zero) return false;
        if (ViGEmNative.vigem_target_add(vigemClient, target) != ViGEmNative.VIGEM_ERROR_NONE) {
          ViGEmNative.vigem_target_free(target);
          return false;
        }
        int capturedSlot = slot;
        PadCallbacks[slot] = delegate(IntPtr c, IntPtr t, byte large, byte small, byte led, IntPtr user) {
          WriteLineSafe("RUMBLE " + capturedSlot + " " + large + " " + small);
        };
        ViGEmNative.vigem_target_x360_register_notification(vigemClient, target, PadCallbacks[slot], IntPtr.Zero);
        PadTargets[slot] = target;
        return true;
      } catch {
        return false;
      }
    }

    private static void UnplugGamepadSlot(int slot) {
      if (slot == 0) ReleaseFallbackGamepad();
      if (slot < 0 || slot >= 4 || PadTargets[slot] == IntPtr.Zero) return;
      try {
        ViGEmNative.vigem_target_x360_unregister_notification(PadTargets[slot]);
        if (vigemClient != IntPtr.Zero) ViGEmNative.vigem_target_remove(vigemClient, PadTargets[slot]);
        ViGEmNative.vigem_target_free(PadTargets[slot]);
      } catch {}
      PadTargets[slot] = IntPtr.Zero;
      PadCallbacks[slot] = null;
    }

    private static void SetFallbackKey(int vk, bool pressed) {
      bool was = HeldFallbackKeys.Contains(vk);
      if (pressed && !was) {
        HeldFallbackKeys.Add(vk);
        SendKey(vk, true);
      } else if (!pressed && was) {
        HeldFallbackKeys.Remove(vk);
        SendKey(vk, false);
      }
    }

    private static void SetFallbackMouse(int btn, bool pressed) {
      bool was = HeldFallbackMouseButtons.Contains(btn);
      if (pressed && !was) {
        HeldFallbackMouseButtons.Add(btn);
        SendMouseButton(btn, true);
      } else if (!pressed && was) {
        HeldFallbackMouseButtons.Remove(btn);
        SendMouseButton(btn, false);
      }
    }

    private static void ReleaseFallbackGamepad() {
      foreach (int vk in new List<int>(HeldFallbackKeys)) {
        SendKey(vk, false);
      }
      HeldFallbackKeys.Clear();
      foreach (int b in new List<int>(HeldFallbackMouseButtons)) {
        SendMouseButton(b, false);
      }
      HeldFallbackMouseButtons.Clear();
    }

    private static void ApplyFallbackGamepad(ushort buttons, byte lt, byte rt, short lx, short ly, short rx, short ry) {
      SetFallbackKey(0x57, ly > 10000);   // W
      SetFallbackKey(0x53, ly < -10000);  // S
      SetFallbackKey(0x41, lx < -10000);  // A
      SetFallbackKey(0x44, lx > 10000);   // D
      SetFallbackKey(0x20, (buttons & 0x1000) != 0); // A -> Space
      SetFallbackKey(0x43, (buttons & 0x2000) != 0); // B -> C
      SetFallbackKey(0x52, (buttons & 0x4000) != 0); // X -> R
      SetFallbackKey(0x45, (buttons & 0x8000) != 0); // Y -> E
      SetFallbackKey(0x51, (buttons & 0x0100) != 0); // LB -> Q
      SetFallbackKey(0x46, (buttons & 0x0200) != 0); // RB -> F
      SetFallbackKey(0x1B, (buttons & 0x0010) != 0); // Start -> Esc
      SetFallbackKey(0x09, (buttons & 0x0020) != 0); // Back -> Tab
      SetFallbackKey(0xA0, (buttons & 0x0040) != 0); // LThumb -> LShift
      SetFallbackMouse(2, lt > 80); // LT -> Right click
      SetFallbackMouse(0, rt > 80); // RT -> Left click

      int dx = Math.Abs((int)rx) > 8000 ? (int)(rx / 2200) : 0;
      int dy = Math.Abs((int)ry) > 8000 ? (int)(-ry / 2200) : 0;
      if (dx != 0 || dy != 0) SendMouseMoveRel(dx, dy);
    }

    private static void HandleGamepad(int slot, ushort buttons, byte lt, byte rt, short lx, short ly, short rx, short ry) {
      if (vigemState == "OK" && EnsureGamepadSlot(slot)) {
        ViGEmNative.XUSB_REPORT rep = new ViGEmNative.XUSB_REPORT();
        rep.wButtons = buttons;
        rep.bLeftTrigger = lt;
        rep.bRightTrigger = rt;
        rep.sThumbLX = lx;
        rep.sThumbLY = ly;
        rep.sThumbRX = rx;
        rep.sThumbRY = ry;
        try {
          uint res = ViGEmNative.vigem_target_x360_update(vigemClient, PadTargets[slot], ref rep);
          if (res != ViGEmNative.VIGEM_ERROR_NONE && slot == 0) {
            ApplyFallbackGamepad(buttons, lt, rt, lx, ly, rx, ry);
          }
        } catch {
          if (slot == 0) ApplyFallbackGamepad(buttons, lt, rt, lx, ly, rx, ry);
        }
        return;
      }
      if (slot == 0) {
        ApplyFallbackGamepad(buttons, lt, rt, lx, ly, rx, ry);
      }
    }

    private static void ScanProcesses() {
      IntPtr snap = Win32Input.CreateToolhelp32Snapshot(Win32Input.TH32CS_SNAPPROCESS, 0);
      if (snap == IntPtr.Zero || snap == new IntPtr(-1)) {
        WriteLineSafe("PROCS ");
        return;
      }
      try {
        Win32Input.PROCESSENTRY32W entry = new Win32Input.PROCESSENTRY32W();
        entry.dwSize = (uint)Marshal.SizeOf(typeof(Win32Input.PROCESSENTRY32W));
        HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (Win32Input.Process32FirstW(snap, ref entry)) {
          do {
            if (!string.IsNullOrEmpty(entry.szExeFile)) {
              names.Add(entry.szExeFile);
            }
          } while (Win32Input.Process32NextW(snap, ref entry));
        }
        StringBuilder sb = new StringBuilder("PROCS ");
        bool first = true;
        foreach (string n in names) {
          if (!first) sb.Append('|');
          first = false;
          sb.Append(n);
        }
        WriteLineSafe(sb.ToString());
      } finally {
        Win32Input.CloseHandle(snap);
      }
    }

    private static void ReleaseAllInputs() {
      ReleaseFallbackGamepad();
      foreach (int vk in new List<int>(HeldKeys)) {
        SendKey(vk, false);
      }
      HeldKeys.Clear();
      foreach (int btn in new List<int>(HeldMouseButtons)) {
        SendMouseButton(btn, false);
      }
      HeldMouseButtons.Clear();
    }

    private static void Cleanup() {
      ReleaseAllInputs();
      for (int i = 0; i < 4; i++) {
        UnplugGamepadSlot(i);
      }
      if (vigemClient != IntPtr.Zero) {
        try {
          ViGEmNative.vigem_disconnect(vigemClient);
          ViGEmNative.vigem_free(vigemClient);
        } catch {}
        vigemClient = IntPtr.Zero;
      }
    }

    public static void Main(string[] args) {
      Console.InputEncoding = Encoding.UTF8;
      Console.OutputEncoding = new UTF8Encoding(false);

      string state = InitViGEm();
      HostPresence.OnChange = (busy) => WriteLineSafe(busy ? "HOST_ACTIVE" : "HOST_IDLE");
      WriteLineSafe("READY vigem=" + state);

      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
          if (string.IsNullOrWhiteSpace(line)) continue;
          string[] p = line.Split(' ');
          string cmd = p[0];
          try {
            // Host mexendo no PC: ignora mouse/teclado remotos (soltar teclas/botões continua liberado)
            if (HostPresence.Active && (cmd == "M" || cmd == "MR" || cmd == "MD" || cmd == "W" || cmd == "KD")) {
              continue;
            }
            if (cmd == "PRIORITY_ON") {
              if (p.Length >= 2) {
                int ms;
                if (int.TryParse(p[1], out ms)) HostPresence.IdleMs = Math.Max(300, Math.Min(10000, ms));
              }
              HostPresence.Start();
            } else if (cmd == "PRIORITY_OFF") {
              HostPresence.Stop();
            } else if (cmd == "RELEASE_KM") {
              foreach (int vk in new List<int>(HeldKeys)) SendKey(vk, false);
              HeldKeys.Clear();
              foreach (int btn in new List<int>(HeldMouseButtons)) SendMouseButton(btn, false);
              HeldMouseButtons.Clear();
            } else if (cmd == "M" && p.Length >= 3) {
              SendMouseAbsolute(int.Parse(p[1]), int.Parse(p[2]));
            } else if (cmd == "MR" && p.Length >= 3) {
              SendMouseMoveRel(int.Parse(p[1]), int.Parse(p[2]));
            } else if (cmd == "MD" && p.Length >= 2) {
              SendMouseButton(int.Parse(p[1]), true);
            } else if (cmd == "MU" && p.Length >= 2) {
              SendMouseButton(int.Parse(p[1]), false);
            } else if (cmd == "W" && p.Length >= 2) {
              SendWheel(int.Parse(p[1]));
            } else if (cmd == "KD" && p.Length >= 2) {
              SendKey(int.Parse(p[1]), true);
            } else if (cmd == "KU" && p.Length >= 2) {
              SendKey(int.Parse(p[1]), false);
            } else if (cmd == "GP" && p.Length >= 9) {
              HandleGamepad(
                int.Parse(p[1]),
                ushort.Parse(p[2]),
                byte.Parse(p[3]),
                byte.Parse(p[4]),
                short.Parse(p[5]),
                short.Parse(p[6]),
                short.Parse(p[7]),
                short.Parse(p[8])
              );
            } else if (cmd == "GP_OFF" && p.Length >= 2) {
              UnplugGamepadSlot(int.Parse(p[1]));
            } else if (cmd == "VIGEM_RETRY") {
              WriteLineSafe("VIGEM " + InitViGEm());
            } else if (cmd == "SCAN_PROCS") {
              ScanProcesses();
            } else if (cmd == "RELEASE_ALL") {
              ReleaseAllInputs();
            }
          } catch {}
        }
      } finally {
        HostPresence.Stop();
        Cleanup();
      }
    }
  }
}
