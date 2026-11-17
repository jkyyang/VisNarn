// Runs before `npm run dev` and `npm start`: if something is listening on the app's port, stop it.
// Only that one port (VISNARN_PORT, default 5173); copies of the app on other ports are left alone.
import { execFileSync } from "node:child_process";

const port = Number(process.env.VISNARN_PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(0); // the server reports a bad VISNARN_PORT itself

let pids = [];
try {
  pids = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
} catch {
  // lsof exits 1 when nothing is listening: the port is free.
}
for (const pid of pids) {
  process.kill(pid, "SIGKILL");
  console.log(`Port ${port} was in use by process ${pid}: stopped it.`);
}
