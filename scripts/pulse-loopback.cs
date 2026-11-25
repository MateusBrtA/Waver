using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace PulseCordLoopback
{
    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IActivateAudioInterfaceAsyncOperation
    {
        [PreserveSig]
        int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig]
        int ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAgileObject
    {
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClient
    {
        [PreserveSig]
        int Initialize(int shareMode, uint streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, [MarshalAs(UnmanagedType.LPStruct)] Guid audioSessionGuid);
        [PreserveSig]
        int GetBufferSize(out uint numBufferFrames);
        [PreserveSig]
        int GetStreamLatency(out long hnsLatency);
        [PreserveSig]
        int GetCurrentPadding(out uint numPaddingFrames);
        [PreserveSig]
        int IsFormatSupported(int shareMode, IntPtr pFormat, out IntPtr closestMatch);
        [PreserveSig]
        int GetMixFormat(out IntPtr deviceFormat);
        [PreserveSig]
        int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig]
        int Start();
        [PreserveSig]
        int Stop();
        [PreserveSig]
        int Reset();
        [PreserveSig]
        int SetEventHandle(IntPtr eventHandle);
        [PreserveSig]
        int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioCaptureClient
    {
        [PreserveSig]
        int GetBuffer(out IntPtr data, out uint numFramesToRead, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig]
        int ReleaseBuffer(uint numFramesRead);
        [PreserveSig]
        int GetNextPacketSize(out uint numFramesInNextPacket);
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROCESS_LOOPBACK_PARAMS
    {
        public uint TargetProcessId;
        public int ProcessLoopbackMode;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct AUDIOCLIENT_ACTIVATION_PARAMS
    {
        public int ActivationType;
        public PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    }

    // x64 PROPVARIANT for VT_BLOB (vt=65)
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    internal struct PropVariantBlob
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public uint cbSize;
        [FieldOffset(16)] public IntPtr pBlobData;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    internal static class Native
    {
        public const string VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = "VAD\\Process_Loopback";
        public const int AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1;
        public const int PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1;
        public const int AUDCLNT_SHAREMODE_SHARED = 0;
        public const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        public const uint AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
        public const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;

        public static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        public static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

        [DllImport("mmdevapi.dll", PreserveSig = true)]
        public static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            IntPtr activationParams,
            [MarshalAs(UnmanagedType.Interface)] IActivateAudioInterfaceCompletionHandler completionHandler,
            out IActivateAudioInterfaceAsyncOperation activationOperation
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateEvent(IntPtr lpEventAttributes, bool bManualReset, bool bInitialState, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);
    }

    [ComVisible(true)]
    internal sealed class ActivationHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
        public int HResult = -1;
        public IAudioClient Client = null;

        public int ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            try
            {
                int initHr;
                object iface;
                int hr = activateOperation.GetActivateResult(out initHr, out iface);
                HResult = hr < 0 ? hr : initHr;
                if (HResult >= 0 && iface != null)
                {
                    Client = (IAudioClient)iface;
                }
            }
            catch (Exception ex)
            {
                HResult = Marshal.GetHRForException(ex);
            }
            finally
            {
                Done.Set();
            }
            return 0;
        }
    }

    internal static class Program
    {
        private static volatile bool _running = true;

        [MTAThread]
        private static int Main(string[] args)
        {
            if (args.Length < 1)
            {
                Console.Error.WriteLine("ERR: missing PID");
                return 2;
            }

            uint targetPid;
            if (!uint.TryParse(args[0], out targetPid) || targetPid == 0)
            {
                Console.Error.WriteLine("ERR: invalid PID");
                return 2;
            }

            // Watch stdin so parent closing pipe cleanly terminates helper
            Thread stdinThread = new Thread(() =>
            {
                try
                {
                    Stream stdin = Console.OpenStandardInput();
                    byte[] tmp = new byte[64];
                    while (stdin.Read(tmp, 0, tmp.Length) > 0) { }
                }
                catch { }
                _running = false;
            });
            stdinThread.IsBackground = true;
            stdinThread.Start();

            IntPtr pParams = IntPtr.Zero;
            IntPtr pPropVar = IntPtr.Zero;
            IntPtr pWfx = IntPtr.Zero;
            IntPtr hEvent = IntPtr.Zero;
            IActivateAudioInterfaceAsyncOperation asyncOp = null;
            IAudioClient audioClient = null;
            IAudioCaptureClient captureClient = null;

            try
            {
                AUDIOCLIENT_ACTIVATION_PARAMS actParams = new AUDIOCLIENT_ACTIVATION_PARAMS
                {
                    ActivationType = Native.AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
                    ProcessLoopbackParams = new PROCESS_LOOPBACK_PARAMS
                    {
                        TargetProcessId = targetPid,
                        ProcessLoopbackMode = Native.PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
                    }
                };

                int paramsSize = Marshal.SizeOf(typeof(AUDIOCLIENT_ACTIVATION_PARAMS));
                pParams = Marshal.AllocHGlobal(paramsSize);
                Marshal.StructureToPtr(actParams, pParams, false);

                PropVariantBlob pv = new PropVariantBlob
                {
                    vt = 65, // VT_BLOB
                    cbSize = (uint)paramsSize,
                    pBlobData = pParams
                };
                pPropVar = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(PropVariantBlob)));
                Marshal.StructureToPtr(pv, pPropVar, false);

                ActivationHandler handler = new ActivationHandler();
                int hr = Native.ActivateAudioInterfaceAsync(
                    Native.VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                    Native.IID_IAudioClient,
                    pPropVar,
                    handler,
                    out asyncOp
                );
                if (hr < 0)
                {
                    Console.Error.WriteLine("ERR: ActivateAudioInterfaceAsync=0x" + hr.ToString("X8"));
                    return 3;
                }

                if (!handler.Done.Wait(4000))
                {
                    Console.Error.WriteLine("ERR: activation timeout");
                    return 4;
                }

                if (handler.HResult < 0 || handler.Client == null)
                {
                    Console.Error.WriteLine("ERR: ActivateCompleted=0x" + handler.HResult.ToString("X8"));
                    return 5;
                }

                audioClient = handler.Client;

                WAVEFORMATEX wfx = new WAVEFORMATEX
                {
                    wFormatTag = 1, // WAVE_FORMAT_PCM
                    nChannels = 2,
                    nSamplesPerSec = 48000,
                    wBitsPerSample = 16,
                    nBlockAlign = 4,
                    nAvgBytesPerSec = 192000,
                    cbSize = 0
                };
                pWfx = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WAVEFORMATEX)));
                Marshal.StructureToPtr(wfx, pWfx, false);

                uint flags = Native.AUDCLNT_STREAMFLAGS_LOOPBACK | Native.AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
                hr = audioClient.Initialize(Native.AUDCLNT_SHAREMODE_SHARED, flags, 200000, 0, pWfx, Guid.Empty);
                if (hr < 0)
                {
                    Console.Error.WriteLine("ERR: Initialize=0x" + hr.ToString("X8"));
                    return 6;
                }

                hEvent = Native.CreateEvent(IntPtr.Zero, false, false, null);
                if (hEvent == IntPtr.Zero)
                {
                    Console.Error.WriteLine("ERR: CreateEvent failed");
                    return 7;
                }

                hr = audioClient.SetEventHandle(hEvent);
                if (hr < 0)
                {
                    Console.Error.WriteLine("ERR: SetEventHandle=0x" + hr.ToString("X8"));
                    return 8;
                }

                object capObj;
                hr = audioClient.GetService(Native.IID_IAudioCaptureClient, out capObj);
                if (hr < 0 || capObj == null)
                {
                    Console.Error.WriteLine("ERR: GetService=0x" + hr.ToString("X8"));
                    return 9;
                }
                captureClient = (IAudioCaptureClient)capObj;

                hr = audioClient.Start();
                if (hr < 0)
                {
                    Console.Error.WriteLine("ERR: Start=0x" + hr.ToString("X8"));
                    return 10;
                }

                Console.Error.WriteLine("READY");
                Console.Error.Flush();

                Stream stdout = Console.OpenStandardOutput();
                byte[] copyBuf = new byte[192000];
                byte[] silentBuf = new byte[192000];

                while (_running)
                {
                    Native.WaitForSingleObject(hEvent, 100);
                    if (!_running) break;

                    uint packetFrames = 0;
                    hr = captureClient.GetNextPacketSize(out packetFrames);
                    if (hr < 0) break;

                    while (packetFrames > 0 && _running)
                    {
                        IntPtr pData;
                        uint numFrames;
                        uint bufFlags;
                        ulong devPos, qpcPos;
                        hr = captureClient.GetBuffer(out pData, out numFrames, out bufFlags, out devPos, out qpcPos);
                        if (hr < 0) break;

                        int bytesToWrite = (int)(numFrames * 4);
                        if (bytesToWrite > 0 && bytesToWrite <= copyBuf.Length)
                        {
                            if ((bufFlags & Native.AUDCLNT_BUFFERFLAGS_SILENT) != 0)
                            {
                                Array.Clear(silentBuf, 0, bytesToWrite);
                                stdout.Write(silentBuf, 0, bytesToWrite);
                            }
                            else
                            {
                                Marshal.Copy(pData, copyBuf, 0, bytesToWrite);
                                stdout.Write(copyBuf, 0, bytesToWrite);
                            }
                        }

                        captureClient.ReleaseBuffer(numFrames);
                        hr = captureClient.GetNextPacketSize(out packetFrames);
                        if (hr < 0) break;
                    }
                    stdout.Flush();
                }

                try { audioClient.Stop(); } catch { }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("ERR: " + ex.Message);
                return 1;
            }
            finally
            {
                try { if (asyncOp != null) Marshal.ReleaseComObject(asyncOp); } catch { }
                try { if (captureClient != null) Marshal.ReleaseComObject(captureClient); } catch { }
                try { if (audioClient != null) Marshal.ReleaseComObject(audioClient); } catch { }
                if (hEvent != IntPtr.Zero) Native.CloseHandle(hEvent);
                if (pWfx != IntPtr.Zero) Marshal.FreeHGlobal(pWfx);
                if (pPropVar != IntPtr.Zero) Marshal.FreeHGlobal(pPropVar);
                if (pParams != IntPtr.Zero) Marshal.FreeHGlobal(pParams);
            }
        }
    }
}
