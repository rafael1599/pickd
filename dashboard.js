#!/usr/bin/env node
import blessed from "blessed";
import { spawn } from "child_process";
import { platform } from "os";

const IS_WIN = platform() === "win32";

// ── State ──────────────────────────────────────────────
const state = {
  supabase: { proc: null, status: "stopped", pid: null },
  vite: { proc: null, status: "stopped", pid: null },
};

// ── Screen ─────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: "PickD Dashboard",
  fullUnicode: true,
});

// ── Header ─────────────────────────────────────────────
blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: "100%",
  height: 3,
  content: "{center}{bold} PICKD DASHBOARD {/bold}{/center}",
  tags: true,
  style: { fg: "white", bg: "blue", bold: true },
});

// ── Status bar ─────────────────────────────────────────
const statusBar = blessed.box({
  parent: screen,
  top: 3,
  left: 0,
  width: "100%",
  height: 3,
  tags: true,
  style: { fg: "white", bg: "#333" },
  padding: { left: 1, right: 1 },
});

function updateStatus() {
  const sb = state.supabase;
  const vt = state.vite;
  const icon = (s) =>
    s === "running"
      ? "{green-fg}●{/green-fg}"
      : s === "starting"
        ? "{yellow-fg}◐{/yellow-fg}"
        : "{red-fg}○{/red-fg}";
  const label = (s) =>
    s === "running"
      ? "{green-fg}RUNNING{/green-fg}"
      : s === "starting"
        ? "{yellow-fg}STARTING{/yellow-fg}"
        : "{red-fg}STOPPED{/red-fg}";
  statusBar.setContent(
    ` ${icon(sb.status)} Supabase: ${label(sb.status)}${sb.pid ? ` (PID ${sb.pid})` : ""}` +
      `     ${icon(vt.status)} Vite: ${label(vt.status)}${vt.pid ? ` (PID ${vt.pid})` : ""}`,
  );
  screen.render();
}

// ── Log panels ─────────────────────────────────────────
const supabaseLog = blessed.log({
  parent: screen,
  label: " {bold}Supabase Logs{/bold} ",
  tags: true,
  top: 6,
  left: 0,
  width: "50%",
  height: "100%-9",
  border: { type: "line" },
  style: {
    fg: "white",
    border: { fg: "cyan" },
    label: { fg: "cyan" },
    scrollbar: { bg: "cyan" },
  },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: "█" },
  mouse: true,
  keys: true,
});

const viteLog = blessed.log({
  parent: screen,
  label: " {bold}Vite / Frontend Logs{/bold} ",
  tags: true,
  top: 6,
  left: "50%",
  width: "50%",
  height: "100%-9",
  border: { type: "line" },
  style: {
    fg: "white",
    border: { fg: "green" },
    label: { fg: "green" },
    scrollbar: { bg: "green" },
  },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: "█" },
  mouse: true,
  keys: true,
});

// ── Button bar ─────────────────────────────────────────
const buttonBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: "100%",
  height: 3,
  style: { bg: "#222" },
});

const buttons = [
  { key: "F1", label: "Start All", action: startAll },
  { key: "F2", label: "Stop All", action: stopAll },
  { key: "F3", label: "Restart All", action: restartAll },
  { key: "F5", label: "Supabase", action: toggleSupabase },
  { key: "F6", label: "Vite", action: toggleVite },
  { key: "F7", label: "Sync Prod", action: syncProd },
  { key: "F9", label: "Clear Logs", action: clearLogs },
  { key: "F10", label: "Quit", action: gracefulExit },
];

buttons.forEach((btn, i) => {
  const width = Math.floor(100 / buttons.length);
  blessed.button({
    parent: buttonBar,
    content: `{bold}${btn.key}{/bold} ${btn.label}`,
    tags: true,
    left: `${i * width}%`,
    width: `${width}%`,
    height: 3,
    mouse: true,
    style: {
      fg: "white",
      bg: "#444",
      hover: { bg: "blue" },
      focus: { bg: "blue" },
    },
    padding: { left: 1 },
  }).on("press", btn.action);
});

// ── Helpers ────────────────────────────────────────────
function log(panel, msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  panel.log(`{gray-fg}[${ts}]{/gray-fg} ${msg}`);
}

// On Windows, spawn needs shell:true for .cmd executables (npx, docker, etc.)
const spawnOpts = IS_WIN ? { shell: true } : {};

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { ...spawnOpts, ...opts });
}

function isDockerRunning() {
  try {
    const result = run("docker", ["info"], { stdio: "pipe", timeout: 5000 });
    return new Promise((resolve) => {
      result.on("close", (code) => resolve(code === 0));
      result.on("error", () => resolve(false));
    });
  } catch {
    return Promise.resolve(false);
  }
}

async function ensureDocker() {
  if (await isDockerRunning()) return true;
  if (IS_WIN) {
    log(supabaseLog, "{yellow-fg}Docker not running, starting Docker Desktop...{/yellow-fg}");
    spawn("cmd", ["/c", "start", "", "Docker Desktop"], { stdio: "ignore" });
  } else {
    log(supabaseLog, "{yellow-fg}Docker not running, starting OrbStack...{/yellow-fg}");
    spawn("open", ["-a", "OrbStack"]);
  }
  // Wait up to 30s for docker
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isDockerRunning()) {
      log(supabaseLog, "{green-fg}Docker is ready.{/green-fg}");
      return true;
    }
  }
  log(supabaseLog, "{red-fg}ERROR: Could not start Docker after 30s.{/red-fg}");
  return false;
}

// ── Supabase ───────────────────────────────────────────
async function startSupabase() {
  if (state.supabase.status === "running" || state.supabase.status === "starting") {
    log(supabaseLog, "{yellow-fg}Supabase already running/starting.{/yellow-fg}");
    return;
  }

  if (!(await ensureDocker())) return;

  state.supabase.status = "starting";
  updateStatus();
  log(supabaseLog, "Starting Supabase...");

  const proc = run("npx", ["supabase", "start"], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  state.supabase.proc = proc;
  state.supabase.pid = proc.pid;

  const pipe = (stream) => {
    stream.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      lines.forEach((line) => {
        // Strip ANSI
        const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
        if (clean) log(supabaseLog, clean);
      });
    });
  };

  pipe(proc.stdout);
  pipe(proc.stderr);

  proc.on("close", (code) => {
    if (code === 0) {
      state.supabase.status = "running";
      log(supabaseLog, "{green-fg}Supabase started successfully.{/green-fg}");
    } else {
      // Check if it failed because ports are already in use (already running)
      state.supabase.status = "stopped";
      log(supabaseLog, `{red-fg}Supabase exited with code ${code}.{/red-fg}`);
    }
    state.supabase.proc = null;
    updateStatus();
  });

  proc.on("error", (err) => {
    state.supabase.status = "stopped";
    state.supabase.proc = null;
    log(supabaseLog, `{red-fg}ERROR: ${err.message}{/red-fg}`);
    updateStatus();
  });

  updateStatus();
}

async function stopSupabase() {
  if (state.supabase.status === "stopped") {
    log(supabaseLog, "{yellow-fg}Supabase already stopped.{/yellow-fg}");
    return;
  }

  log(supabaseLog, "Stopping Supabase...");
  state.supabase.status = "stopping";
  updateStatus();

  const proc = run("npx", ["supabase", "stop"], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => log(supabaseLog, l.replace(/\x1b\[[0-9;]*m/g, "").trim())),
  );
  proc.stderr.on("data", (d) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => log(supabaseLog, l.replace(/\x1b\[[0-9;]*m/g, "").trim())),
  );

  return new Promise((resolve) => {
    proc.on("close", () => {
      state.supabase.status = "stopped";
      state.supabase.pid = null;
      log(supabaseLog, "{green-fg}Supabase stopped.{/green-fg}");
      updateStatus();
      resolve();
    });
    proc.on("error", () => {
      state.supabase.status = "stopped";
      updateStatus();
      resolve();
    });
  });
}

async function toggleSupabase() {
  if (state.supabase.status === "running") await stopSupabase();
  else await startSupabase();
}

// ── Vite ───────────────────────────────────────────────
function startVite() {
  if (state.vite.status === "running") {
    log(viteLog, "{yellow-fg}Vite already running.{/yellow-fg}");
    return;
  }

  state.vite.status = "starting";
  updateStatus();
  log(viteLog, "Starting Vite dev server...");

  const proc = run("npx", ["vite", "--clearScreen", "false"], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  state.vite.proc = proc;
  state.vite.pid = proc.pid;

  const pipe = (stream) => {
    stream.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      lines.forEach((line) => {
        const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
        if (clean) {
          log(viteLog, clean);
          // Detect ready
          if (clean.includes("ready in") || clean.includes("Local:")) {
            state.vite.status = "running";
            updateStatus();
          }
        }
      });
    });
  };

  pipe(proc.stdout);
  pipe(proc.stderr);

  proc.on("close", (code) => {
    state.vite.status = "stopped";
    state.vite.pid = null;
    state.vite.proc = null;
    if (code !== null && code !== 0) {
      log(viteLog, `{red-fg}Vite exited with code ${code}.{/red-fg}`);
    } else {
      log(viteLog, "{yellow-fg}Vite stopped.{/yellow-fg}");
    }
    updateStatus();
  });

  proc.on("error", (err) => {
    state.vite.status = "stopped";
    state.vite.proc = null;
    log(viteLog, `{red-fg}ERROR: ${err.message}{/red-fg}`);
    updateStatus();
  });

  updateStatus();
}

function stopVite() {
  if (!state.vite.proc) {
    state.vite.status = "stopped";
    log(viteLog, "{yellow-fg}Vite already stopped.{/yellow-fg}");
    updateStatus();
    return Promise.resolve();
  }

  log(viteLog, "Stopping Vite...");

  return new Promise((resolve) => {
    const proc = state.vite.proc;
    const timeout = setTimeout(() => {
      log(viteLog, "{yellow-fg}Force killing Vite...{/yellow-fg}");
      proc.kill("SIGKILL");
    }, 5000);

    proc.on("close", () => {
      clearTimeout(timeout);
      state.vite.status = "stopped";
      state.vite.pid = null;
      state.vite.proc = null;
      log(viteLog, "{green-fg}Vite stopped.{/green-fg}");
      updateStatus();
      resolve();
    });

    proc.kill("SIGTERM");
  });
}

function toggleVite() {
  if (state.vite.status === "running") return stopVite();
  else return startVite();
}

// ── Sync Prod ─────────────────────────────────────────
async function syncProd() {
  if (state.supabase.status !== "running") {
    log(supabaseLog, "{red-fg}Supabase must be running before sync.{/red-fg}");
    return;
  }

  log(supabaseLog, "{bold}=== Sync Prod → Local ==={/bold}");

  // Step 1: Check if local schema exists
  log(supabaseLog, "Checking local schema...");
  const tableCount = await new Promise((resolve) => {
    const check = run("docker", [
      "exec", "supabase_db_pickd", "psql", "-U", "postgres", "-d", "postgres",
      "-tc", "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    check.stdout.on("data", (d) => (out += d.toString()));
    check.on("close", () => resolve(parseInt(out.trim(), 10) || 0));
    check.on("error", () => resolve(0));
  });

  // Step 2: If schema empty, run db reset first
  if (tableCount === 0) {
    log(supabaseLog, "{yellow-fg}No tables found — applying migrations (db reset)...{/yellow-fg}");
    const resetOk = await new Promise((resolve) => {
      const reset = run("npx", ["supabase", "db", "reset"], {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      reset.stdout.on("data", (d) =>
        d.toString().split("\n").filter(Boolean).forEach((l) =>
          log(supabaseLog, l.replace(/\x1b\[[0-9;]*m/g, "").trim())
        )
      );
      reset.stderr.on("data", (d) =>
        d.toString().split("\n").filter(Boolean).forEach((l) =>
          log(supabaseLog, l.replace(/\x1b\[[0-9;]*m/g, "").trim())
        )
      );
      reset.on("close", (code) => resolve(code === 0));
      reset.on("error", () => resolve(false));
    });

    if (!resetOk) {
      log(supabaseLog, "{red-fg}db reset failed — aborting sync.{/red-fg}");
      return;
    }
    log(supabaseLog, "{green-fg}Schema ready.{/green-fg}");
  } else {
    log(supabaseLog, `{green-fg}Schema OK (${tableCount} tables).{/green-fg}`);
  }

  // Step 3: Run sync script
  log(supabaseLog, "Running sync-local-db.sh...");
  const sync = run("bash", ["scripts/sync-local-db.sh"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  sync.stdout.on("data", (d) =>
    d.toString().split("\n").filter(Boolean).forEach((l) =>
      log(supabaseLog, l.replace(/\x1b\[[0-9;]*m/g, "").trim())
    )
  );
  sync.stderr.on("data", (d) =>
    d.toString().split("\n").filter(Boolean).forEach((l) =>
      log(supabaseLog, `{red-fg}${l.replace(/\x1b\[[0-9;]*m/g, "").trim()}{/red-fg}`)
    )
  );

  sync.on("close", (code) => {
    if (code === 0) {
      log(supabaseLog, "{green-fg}{bold}✅ Sync complete!{/bold}{/green-fg}");
    } else {
      log(supabaseLog, `{red-fg}Sync failed (exit ${code}).{/red-fg}`);
    }
  });
}

// ── Composite actions ──────────────────────────────────
async function startAll() {
  log(supabaseLog, "{bold}=== Starting all services ==={/bold}");
  log(viteLog, "{bold}=== Starting all services ==={/bold}");
  // Start supabase first (backend), then vite
  await startSupabase();
  startVite();
}

async function stopAll() {
  log(supabaseLog, "{bold}=== Stopping all services ==={/bold}");
  log(viteLog, "{bold}=== Stopping all services ==={/bold}");
  await Promise.all([stopVite(), stopSupabase()]);
}

async function restartAll() {
  log(supabaseLog, "{bold}=== Restarting all services ==={/bold}");
  log(viteLog, "{bold}=== Restarting all services ==={/bold}");
  await stopAll();
  await startAll();
}

function clearLogs() {
  supabaseLog.setContent("");
  viteLog.setContent("");
  log(supabaseLog, "Logs cleared.");
  log(viteLog, "Logs cleared.");
}

// ── Graceful exit ──────────────────────────────────────
let exiting = false;
async function gracefulExit() {
  if (exiting) return;
  exiting = true;

  log(supabaseLog, "{bold}Shutting down...{/bold}");
  log(viteLog, "{bold}Shutting down...{/bold}");
  screen.render();

  // Kill vite process directly (fast)
  if (state.vite.proc) {
    state.vite.proc.kill("SIGTERM");
  }

  // Stop supabase containers
  if (state.supabase.status === "running") {
    const stop = run("npx", ["supabase", "stop"], {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    await new Promise((resolve) => {
      stop.on("close", resolve);
      stop.on("error", resolve);
      setTimeout(resolve, 15000); // Don't wait forever
    });
  }

  process.exit(0);
}

// ── Key bindings ───────────────────────────────────────
screen.key(["f1"], startAll);
screen.key(["f2"], stopAll);
screen.key(["f3"], restartAll);
screen.key(["f5"], toggleSupabase);
screen.key(["f6"], toggleVite);
screen.key(["f7"], syncProd);
screen.key(["f9"], clearLogs);
screen.key(["f10", "q", "C-c"], gracefulExit);

// Handle process signals
process.on("SIGINT", gracefulExit);
process.on("SIGTERM", gracefulExit);

// ── Initial render ─────────────────────────────────────
updateStatus();
log(supabaseLog, "Dashboard ready. Press {bold}F1{/bold} to start all services.");
log(viteLog, "Dashboard ready. Press {bold}F1{/bold} to start all services.");

// Check if supabase is already running
run("npx", ["supabase", "status"], {
  cwd: process.cwd(),
  env: { ...process.env, FORCE_COLOR: "0" },
  stdio: ["ignore", "pipe", "pipe"],
}).on("close", (code) => {
  if (code === 0) {
    state.supabase.status = "running";
    log(supabaseLog, "{green-fg}Supabase detected as already running.{/green-fg}");
    updateStatus();
  }
});

screen.render();
