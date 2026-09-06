import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compileWindowsFixture } from './create-native-hook-provider'

/** SSH is a native executable; keep tunnel sockets in that process so termination closes them. */
export async function createNativeSshFixture(directory: string): Promise<void> {
  const source = join(directory, 'ssh.cs')
  await writeFile(
    source,
    `using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
class Ssh {
  static string gates = Environment.GetEnvironmentVariable("OPENCOVE_FAKE_SSH_GATE_DIR");
  static void Phase(string phase) {
    string line = "[opencove-bootstrap-progress:v1] " + phase + "\\n";
    Console.Write(line); Console.Out.Flush();
    File.AppendAllText(Path.Combine(gates, "phases.log"), line);
    while (!File.Exists(Path.Combine(gates, phase + ".release"))) Thread.Sleep(20);
  }
  static void Proxy(TcpClient client, string host, int port) {
    var upstream = new TcpClient();
    try {
      upstream.Connect(host, port);
      var reverse = new Thread(() => {
        try { upstream.GetStream().CopyTo(client.GetStream()); } catch {} finally { client.Close(); upstream.Close(); }
      });
      reverse.IsBackground = true; reverse.Start();
      client.GetStream().CopyTo(upstream.GetStream());
    } catch {} finally { client.Close(); upstream.Close(); }
  }
  static int Main(string[] args) {
    int forward = Array.IndexOf(args, "-L");
    if (forward >= 0) {
      if (!String.IsNullOrEmpty(gates)) File.AppendAllText(Path.Combine(gates, "tunnel-started"), "started\\n");
      var mapping = args[forward + 1].Split(':');
      var listener = new TcpListener(IPAddress.Loopback, Int32.Parse(mapping[0]));
      listener.Start();
      while (true) {
        var client = listener.AcceptTcpClient();
        var relay = new Thread(() => Proxy(client, mapping[1], Int32.Parse(mapping[2])));
        relay.IsBackground = true; relay.Start();
      }
    }
    if (args.Any(arg => arg.Contains("printf posix"))) { Console.Write("posix"); return 0; }
    if (args.Any(arg => arg.Contains("PSVersionTable"))) { Console.Write("7.4.0"); return 0; }
    Console.In.ReadToEnd();
    if (!String.IsNullOrEmpty(gates)) {
      Phase("checking_remote_runtime"); Phase("installing_runtime"); Phase("starting_runtime");
      string failure = Environment.GetEnvironmentVariable("OPENCOVE_FAKE_SSH_FAILURE");
      if (!String.IsNullOrEmpty(failure)) { Console.Error.WriteLine("[opencove-bootstrap:" + failure + "] Runtime activation deferred."); return 1; }
    }
    return 0;
  }
}
`,
  )
  compileWindowsFixture(source, join(directory, 'ssh.exe'))
}
