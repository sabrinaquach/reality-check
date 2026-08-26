/**
 * Runs the API and the Vite dev server together without pulling in a task
 * runner. Either one dying takes the other down, so you never end up with a
 * half-running stack that fails in confusing ways.
 */
import { spawn } from "node:child_process";

const kids = ["dev:api", "dev:web"].map((script) =>
  spawn("npm", ["run", "--silent", script], { stdio: "inherit", shell: false }),
);

const stopAll = (code) => {
  for (const k of kids) if (!k.killed) k.kill("SIGTERM");
  process.exit(code ?? 0);
};

for (const k of kids) k.on("exit", (code) => stopAll(code ?? 0));
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
