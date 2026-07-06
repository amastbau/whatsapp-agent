import { execFile } from "child_process";

const TIMEOUT_MS = 30000;

export function runCommand(command) {
  return new Promise((resolve) => {
    if (command.includes("sudo")) {
      resolve({ success: false, output: "Rejected: sudo not allowed" });
      return;
    }

    const args = command.split(/\s+/);
    const cmd = args.shift();

    execFile(cmd, args, { timeout: TIMEOUT_MS, shell: false }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed) {
          resolve({ success: false, output: "Command timed out (30s)" });
        } else {
          resolve({ success: false, output: stderr || err.message });
        }
        return;
      }
      resolve({ success: true, output: stdout || stderr || "Done (no output)" });
    });
  });
}
