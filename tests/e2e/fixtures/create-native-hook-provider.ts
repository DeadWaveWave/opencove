import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Match a native CLI entry point. A .cmd fixture introduces cmd.exe's second argument parser,
// which cannot preserve the literal TOML vectors used during Codex hooks/list discovery.
export async function createNativeHookProvider(root: string, fixture: string, provider: string) {
  const source = join(root, 'provider.cs')
  const executable = join(root, 'provider.exe')
  await writeFile(
    source,
    `using System;
using System.Diagnostics;
using System.Linq;
using System.Text;
class Provider {
  static string Quote(string value) {
    var result = new StringBuilder();
    result.Append((char)34);
    int slashes = 0;
    foreach (char c in value) {
      if (c == (char)92) { slashes++; continue; }
      result.Append((char)92, c == (char)34 ? slashes * 2 + 1 : slashes);
      result.Append(c);
      slashes = 0;
    }
    result.Append((char)92, slashes * 2);
    return result.Append((char)34).ToString();
  }
  static int Main(string[] args) {
    var start = new ProcessStartInfo();
    start.FileName = ${JSON.stringify(process.execPath)};
    start.Arguments = String.Join(" ", new string[] { ${JSON.stringify(fixture)}, ${JSON.stringify(provider)} }.Concat(args).Select(Quote));
    start.UseShellExecute = false;
    using (var child = Process.Start(start)) {
      child.WaitForExit();
      return child.ExitCode;
    }
  }
}
`,
  )
  execFileSync(
    join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    ),
    ['/nologo', '/codepage:65001', '/target:exe', `/out:${executable}`, source],
    { windowsHide: true },
  )
  return executable
}
