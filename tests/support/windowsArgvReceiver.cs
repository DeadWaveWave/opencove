using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
class Receiver {
  static int Main(string[] args) {
    string output = Environment.GetEnvironmentVariable("OPENCOVE_ARGV_RECEIVER_OUTPUT");
    File.WriteAllLines(output, args.Select(value => Convert.ToBase64String(Encoding.UTF8.GetBytes(value))).ToArray());
    File.WriteAllText(output + ".transport", String.Join(",", new string[] { "OPENCOVE_NATIVE_COMMAND", "OPENCOVE_NATIVE_ARGUMENTS", "OPENCOVE_NATIVE_CWD" }.Select(name => Environment.GetEnvironmentVariable(name) == null ? "absent" : "leaked")));
    if (Environment.GetEnvironmentVariable("OPENCOVE_ARGV_RECEIVER_INTERACTIVE") != "1") return 37;
    File.WriteAllText(output + ".tty", (!Console.IsInputRedirected && !Console.IsOutputRedirected).ToString());
    Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs input) {
      input.Cancel = true;
      File.WriteAllText(output + ".signal", "Ctrl+C");
      Environment.Exit(37);
    };
    File.WriteAllText(output + ".input", Console.ReadLine());
    while (true) Thread.Sleep(20);
  }
}
