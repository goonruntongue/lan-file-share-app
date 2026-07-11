param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = "Stop"

Add-Type @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class ExeIconExtractor {
  private const uint LOAD_LIBRARY_AS_DATAFILE = 0x00000002;
  private static readonly IntPtr RT_ICON = new IntPtr(3);
  private static readonly IntPtr RT_GROUP_ICON = new IntPtr(14);
  private delegate bool EnumResNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr LoadLibraryEx(string fileName, IntPtr file, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumResNameProc callback, IntPtr param);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr LockResource(IntPtr resource);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint SizeofResource(IntPtr module, IntPtr resource);

  private static byte[] ReadResource(IntPtr module, IntPtr name, IntPtr type) {
    IntPtr resource = FindResource(module, name, type);
    if (resource == IntPtr.Zero) throw new InvalidOperationException("Icon resource was not found.");
    uint size = SizeofResource(module, resource);
    IntPtr data = LockResource(LoadResource(module, resource));
    byte[] bytes = new byte[size];
    Marshal.Copy(data, bytes, 0, checked((int)size));
    return bytes;
  }

  public static void Extract(string executable, string output) {
    IntPtr module = LoadLibraryEx(Path.GetFullPath(executable), IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
    if (module == IntPtr.Zero) throw new InvalidOperationException("Could not open the executable.");
    try {
      IntPtr groupName = IntPtr.Zero;
      EnumResNameProc callback = (m, t, name, p) => { groupName = name; return false; };
      EnumResourceNames(module, RT_GROUP_ICON, callback, IntPtr.Zero);
      GC.KeepAlive(callback);
      if (groupName == IntPtr.Zero) throw new InvalidOperationException("The executable does not contain an icon group.");

      byte[] group = ReadResource(module, groupName, RT_GROUP_ICON);
      ushort count = BitConverter.ToUInt16(group, 4);
      var images = new List<byte[]>();
      for (int i = 0; i < count; i++) {
        int entry = 6 + i * 14;
        ushort id = BitConverter.ToUInt16(group, entry + 12);
        images.Add(ReadResource(module, new IntPtr(id), RT_ICON));
      }

      Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)));
      using (var stream = File.Create(output))
      using (var writer = new BinaryWriter(stream)) {
        writer.Write((ushort)0);
        writer.Write((ushort)1);
        writer.Write(count);
        int offset = 6 + count * 16;
        for (int i = 0; i < count; i++) {
          int source = 6 + i * 14;
          writer.Write(group, source, 8);
          writer.Write(images[i].Length);
          writer.Write(offset);
          offset += images[i].Length;
        }
        foreach (byte[] image in images) writer.Write(image);
      }
    } finally {
      FreeLibrary(module);
    }
  }
}
'@

[ExeIconExtractor]::Extract((Resolve-Path $Executable), $Output)
Write-Host "Extracted icon to $Output"
