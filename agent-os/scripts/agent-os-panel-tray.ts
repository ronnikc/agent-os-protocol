#!/usr/bin/env npx tsx
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen
/**
 * Agent OS Panel — System Tray Launcher
 *
 * Runs the Agent OS Panel server as a background process with a system tray icon.
 * The tray provides quick access to:
 *   - Open the panel in a browser
 *   - View agent/relay status
 *   - Start/stop all agents
 *   - Toggle start-at-login
 *   - Quit (cleanly shuts down panel + relay + all agents)
 *
 * Usage:
 *   npx tsx agent-os/scripts/agent-os-panel-tray.ts [--port 4800] [--lobby <url>]
 *
 * Sprint 38.5.0 — Step 2: System Tray Service
 */

import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform, homedir } from 'node:os';
import SysTrayModule from 'systray2';

const SysTray = (SysTrayModule as any).default ?? SysTrayModule;

// ── Config ──
const args = process.argv.slice(2);
const REPO_ROOT = resolve(import.meta.dirname ?? __dirname, '../..');

// Node v24 on Windows cannot spawn .cmd files (EINVAL). Use node + tsx CLI module directly.
const TSX_CLI = join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

// Forward all args to the panel server
const panelArgs = [...args];

// Extract port for display
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 4800;
const RELAY_PORT = 4722;

// ── Icon ──
// Read favicon.ico and convert to base64 for systray
const ICON_PATH = join(REPO_ROOT, 'agent-os/agent-os-panel/favicon.ico');
const ICON_B64 = existsSync(ICON_PATH) ? readFileSync(ICON_PATH).toString('base64') : '';

// ── Startup Config ──
const CONFIG_DIR = join(homedir(), '.agent-os-panel');
const CONFIG_FILE = join(CONFIG_DIR, 'tray-config.json');

interface TrayConfig {
  startAtLogin: boolean;
  lastLobbyUrl: string;
}

function loadConfig(): TrayConfig {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (existsSync(CONFIG_FILE)) {
    try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); } catch { /* ignore */ }
  }
  return { startAtLogin: false, lastLobbyUrl: '' };
}

function saveConfig(config: TrayConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ── Startup Registration ──
function getStartupCommand(): string {
  const lobby = args.includes('--lobby') ? args.slice(args.indexOf('--lobby'), args.indexOf('--lobby') + 2).join(' ') : '';
  const port = args.includes('--port') ? args.slice(args.indexOf('--port'), args.indexOf('--port') + 2).join(' ') : '';
  return `npx tsx agent-os/scripts/agent-os-panel-tray.ts ${port} ${lobby}`.trim();
}

function installStartup(): boolean {
  const os = platform();
  const cmd = getStartupCommand();

  try {
    if (os === 'win32') {
      // Windows: Create a .vbs shortcut in the Startup folder (no admin required)
      const startupDir = join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'),
        'Microsoft/Windows/Start Menu/Programs/Startup');
      const vbsPath = join(startupDir, 'AgentOSPanel.vbs');
      // Use .vbs to launch silently (no cmd window flash)
      const vbs = `Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${REPO_ROOT.replace(/\\/g, '\\\\')}"
WshShell.Run "cmd /c ${cmd.replace(/"/g, '""')}", 0, False`;
      writeFileSync(vbsPath, vbs);
      console.log(`Startup: created ${vbsPath}`);
      return true;
    } else if (os === 'darwin') {
      // macOS: Create a LaunchAgent plist
      const plistDir = join(homedir(), 'Library/LaunchAgents');
      const plistPath = join(plistDir, 'com.agent-os-panel.plist');
      if (!existsSync(plistDir)) mkdirSync(plistDir, { recursive: true });
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.agent-os-panel</string>
  <key>ProgramArguments</key>
  <array>
    <string>npx</string><string>tsx</string>
    <string>${join(REPO_ROOT, 'agent-os/scripts/agent-os-panel-tray.ts')}</string>
    ${panelArgs.map(a => `<string>${a}</string>`).join('\n    ')}
  </array>
  <key>WorkingDirectory</key><string>${REPO_ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>`;
      writeFileSync(plistPath, plist);
      execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });
      console.log(`Startup: registered macOS LaunchAgent`);
      return true;
    } else {
      // Linux: Create a systemd user service
      const serviceDir = join(homedir(), '.config/systemd/user');
      const servicePath = join(serviceDir, 'agent-os-panel.service');
      if (!existsSync(serviceDir)) mkdirSync(serviceDir, { recursive: true });
      const service = `[Unit]
Description=Agent OS Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
ExecStart=/usr/bin/env npx tsx ${join(REPO_ROOT, 'agent-os/scripts/agent-os-panel-tray.ts')} ${panelArgs.join(' ')}
Restart=on-failure

[Install]
WantedBy=default.target`;
      writeFileSync(servicePath, service);
      execSync('systemctl --user daemon-reload && systemctl --user enable agent-os-panel', { stdio: 'pipe' });
      console.log('Startup: registered systemd user service');
      return true;
    }
  } catch (err) {
    console.error('Startup registration failed:', err);
    return false;
  }
}

async function uninstallStartup(): Promise<boolean> {
  const os = platform();
  try {
    if (os === 'win32') {
      const startupDir = join(process.env.APPDATA || join(homedir(), 'AppData/Roaming'),
        'Microsoft/Windows/Start Menu/Programs/Startup');
      const vbsPath = join(startupDir, 'AgentOSPanel.vbs');
      if (existsSync(vbsPath)) {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(vbsPath);
      }
    } else if (os === 'darwin') {
      const plistPath = join(homedir(), 'Library/LaunchAgents/com.agent-os-panel.plist');
      if (existsSync(plistPath)) {
        execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' });
        const { unlinkSync } = await import('node:fs');
        unlinkSync(plistPath);
      }
    } else {
      execSync('systemctl --user disable agent-os-panel && systemctl --user stop agent-os-panel', { stdio: 'pipe' });
    }
    console.log('Startup: unregistered');
    return true;
  } catch (err) {
    console.error('Startup unregistration failed:', err);
    return false;
  }
}

// ── Handle --install-startup / --uninstall-startup flags ──
if (args.includes('--install-startup')) {
  const config = loadConfig();
  config.startAtLogin = installStartup();
  saveConfig(config);
  process.exit(0);
}

if (args.includes('--uninstall-startup')) {
  const config = loadConfig();
  config.startAtLogin = false;
  saveConfig(config);
  await uninstallStartup();
  process.exit(0);
}

// ── Panel Server Process ──
let panelProcess: ChildProcess | null = null;

function startPanelServer(): void {
  const serverPath = join(REPO_ROOT, 'agent-os/scripts/agent-os-panel-server.ts');
  panelProcess = spawn(process.execPath, [TSX_CLI, serverPath, ...panelArgs], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  panelProcess.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(data);
  });
  panelProcess.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(data);
  });

  panelProcess.on('exit', (code) => {
    console.log(`Panel server exited with code ${code}`);
    panelProcess = null;
  });
}

function stopPanelServer(): void {
  if (panelProcess) {
    panelProcess.kill('SIGTERM');
    setTimeout(() => {
      if (panelProcess?.exitCode === null) panelProcess?.kill('SIGKILL');
    }, 5000);
  }
}

// ── Fetch Panel Status ──
async function fetchPanelStatus(): Promise<{ running: number; total: number; relay: string }> {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/agents/status`);
    const data = await res.json() as { running: number; total: number };
    const relayRes = await fetch(`http://localhost:${PORT}/api/relay`);
    const relayData = await relayRes.json() as { status: string };
    return { running: data.running ?? 0, total: data.total ?? 0, relay: relayData.status ?? 'unknown' };
  } catch {
    return { running: 0, total: 0, relay: 'unknown' };
  }
}

// ── System Tray ──
const config = loadConfig();

// Fix Linux/macOS permissions on systray binary (npm install doesn't always preserve +x)
try {
  const trayBinDir = join(REPO_ROOT, 'node_modules/systray2/traybin');
  if (existsSync(trayBinDir)) {
    const os = platform();
    const binName = os === 'linux' ? 'tray_linux_release' : os === 'darwin' ? 'tray_darwin_release' : null;
    if (binName) {
      const binPath = join(trayBinDir, binName);
      if (existsSync(binPath)) {
        execSync(`chmod +x "${binPath}"`, { stdio: 'pipe' });
      }
    }
  }
} catch { /* ignore — Windows doesn't need chmod */ }

const systray = new SysTray({
  menu: {
    icon: ICON_B64,
    title: 'Agent OS',
    tooltip: `Agent OS Panel (localhost:${PORT})`,
    items: [
      { title: `Agent OS Panel — :${PORT}`, tooltip: 'Open in browser', enabled: true },
      { title: '─────────────', enabled: false },
      { title: 'Agents: loading...', tooltip: 'Agent status', enabled: false },
      { title: 'Relay: loading...', tooltip: 'Relay server status', enabled: false },
      { title: '─────────────', enabled: false },
      { title: 'Open Panel', tooltip: 'Open http://localhost:' + PORT, enabled: true },
      { title: 'Restart Relay', tooltip: 'Restart the relay server', enabled: true },
      { title: '─────────────', enabled: false },
      { title: config.startAtLogin ? '✓ Start at Login' : '  Start at Login', tooltip: 'Toggle auto-start', enabled: true },
      { title: '─────────────', enabled: false },
      { title: 'Quit', tooltip: 'Stop everything and exit', enabled: true },
    ],
  },
  debug: false,
  copyDir: false,
});

// Menu item indices
const IDX_HEADER = 0;
const IDX_AGENTS = 2;
const IDX_RELAY = 3;
const IDX_OPEN = 5;
const IDX_RESTART_RELAY = 6;
const IDX_STARTUP = 8;
const IDX_QUIT = 10;

systray.onClick(async (action) => {
  const idx = action.seq_id;

  if (idx === IDX_OPEN || idx === IDX_HEADER) {
    const url = `http://localhost:${PORT}`;
    const os = platform();
    try {
      if (os === 'win32') execSync(`start ${url}`, { stdio: 'pipe' });
      else if (os === 'darwin') execSync(`open ${url}`, { stdio: 'pipe' });
      else execSync(`xdg-open ${url}`, { stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  if (idx === IDX_RESTART_RELAY) {
    try { await fetch(`http://localhost:${PORT}/api/relay/restart`, { method: 'POST' }); } catch { /* ignore */ }
    systray.sendAction({ type: 'update-item', item: { ...systray.internalRecords.menu.items[IDX_RELAY], title: 'Relay: restarting...' }, seq_id: IDX_RELAY });
  }

  if (idx === IDX_STARTUP) {
    config.startAtLogin = !config.startAtLogin;
    if (config.startAtLogin) {
      installStartup();
    } else {
      await uninstallStartup();
    }
    saveConfig(config);
    systray.sendAction({
      type: 'update-item',
      item: { ...systray.internalRecords.menu.items[IDX_STARTUP], title: config.startAtLogin ? '✓ Start at Login' : '  Start at Login' },
      seq_id: IDX_STARTUP,
    });
  }

  if (idx === IDX_QUIT) {
    console.log('Tray: quitting...');
    stopPanelServer();
    systray.kill(false);
    // Give the panel server time to shut down gracefully
    setTimeout(() => process.exit(0), 2000);
  }
});

// ── Status Refresh (every 5s, with 8s initial delay for server startup) ──
async function updateTrayStatus() {
  const status = await fetchPanelStatus();
  try {
    systray.sendAction({
      type: 'update-item',
      item: { ...systray.internalRecords.menu.items[IDX_AGENTS], title: `Agents: ${status.running} / ${status.total} running` },
      seq_id: IDX_AGENTS,
    });
    systray.sendAction({
      type: 'update-item',
      item: { ...systray.internalRecords.menu.items[IDX_RELAY], title: `Relay: ${status.relay}` },
      seq_id: IDX_RELAY,
    });
  } catch { /* tray may not be ready yet */ }
}
setTimeout(() => {
  updateTrayStatus(); // First update after server has had time to start
  setInterval(updateTrayStatus, 5000);
}, 8000);

// ── Start ──
// The tray runs in the foreground — the tray icon IS the UI.
// For background/no-terminal mode, use --install-startup which creates a .vbs
// script that launches silently (no cmd window) at login.
console.log('Agent OS Panel Tray starting...');
console.log(`Panel: http://localhost:${PORT}`);
console.log(`Relay: ws://localhost:${RELAY_PORT}`);
console.log('The system tray icon is your control surface. You can minimize this terminal.');

startPanelServer();

// Graceful shutdown
process.on('SIGTERM', () => { stopPanelServer(); systray.kill(false); process.exit(0); });
process.on('SIGINT', () => { stopPanelServer(); systray.kill(false); process.exit(0); });
