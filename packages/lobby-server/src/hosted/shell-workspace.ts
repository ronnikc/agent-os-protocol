// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 R Digital

import type { WorkspaceAdapter, WorkspaceCapabilities, WorkspaceAttempt, WorkspaceAllocationJournal } from '@agent-os/protocol-core';
import type { WorkspaceAllocationRecovery } from './workspace-allocation.js';
import { workspaceRepository } from './workspace-repository.js';

export type WorkspaceGuest = {
  upload(data: Uint8Array, signal: AbortSignal): Promise<void>;
  run(command: string, options: { signal: AbortSignal; timeoutMs: number; retainOutput?: boolean }): Promise<{ stdout?: string } | void>;
  read(path: string, signal: AbortSignal): Promise<string>;
};
const root = '/tmp/agent-os-workspace';
const fileTool = `
import base64, json, os, stat, sys
operation, encoded_path, encoded_content = sys.argv[1:]
path = base64.b64decode(encoded_path).decode()
parts = path.split("/") if path else []
directory = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
fd = os.open("/tmp/agent-os-workspace/source", directory)
try:
    for part in (parts if operation == "list" else parts[:-1]):
        if operation == "write":
            try:
                os.mkdir(part, dir_fd=fd)
            except FileExistsError:
                pass
        child = os.open(part, directory, dir_fd=fd)
        os.close(fd)
        fd = child
    if operation == "list":
        with os.scandir(fd) as entries:
            names = []
            for entry in entries:
                if entry.name.lower() != ".git" and not entry.is_symlink():
                    names.append(entry.name)
                if len(names) == 500:
                    break
        print(json.dumps(sorted(names)))
    elif operation == "read":
        file = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(file, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("Expected a regular file")
            print(base64.b64encode(stream.read(65536)).decode())
    elif operation == "write":
        import secrets
        name = ".agent-os-" + secrets.token_hex(16)
        file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644, dir_fd=fd)
        try:
            with os.fdopen(file, "wb") as stream:
                stream.write(base64.b64decode(encoded_content))
            os.replace(name, parts[-1], src_dir_fd=fd, dst_dir_fd=fd)
        finally:
            try:
                os.unlink(name, dir_fd=fd)
            except FileNotFoundError:
                pass
finally:
    os.close(fd)
`;

function shellArgument(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function createShellWorkspace(
  capabilities: WorkspaceCapabilities,
  config: { command: string; maxMicrosPerSecond: number },
  connect: (id: string, credential: string, signal: AbortSignal) => Promise<WorkspaceGuest>,
  allocation: (key: string, credential: string, journal: WorkspaceAllocationJournal, attempt?: WorkspaceAttempt) => WorkspaceAllocationRecovery,
): WorkspaceAdapter {
  return {
    capabilities,
    async openFileTools(credential, signal, journal) {
      const id = journal.read().providerId;
      if (!id) throw new Error('Workspace allocation is unavailable.');
      const guest = await connect(id, credential, signal);
      const invoke = async (operation: string, path: string, content = '') => {
        const result = await guest.run(['python3', '-I', '-c', shellArgument(fileTool), operation,
          shellArgument(Buffer.from(path).toString('base64')), shellArgument(content)].join(' '),
        { signal, timeoutMs: 10_000 });
        return result?.stdout ?? '';
      };
      return workspaceRepository({
        read: async path => Buffer.from((await invoke('read', path)).trim(), 'base64').toString('utf8'),
        list: async path => JSON.parse(await invoke('list', path)) as string[],
        write: async (path, content) => {
          // Keep each argument under Linux's per-argument limit.
          await invoke('write', path, Buffer.from(content).toString('base64'));
        },
      }, signal);
    },
    estimate: attempt => Math.ceil((attempt.deadline - Date.now()) / 1000) * config.maxMicrosPerSecond,
    async provision(key, attempt, credential, signal, journal, source) {
      if (!source) throw new Error('Workspace source is unavailable.');
      const archive = await source();
      const id = await allocation(key, credential, journal, attempt).provision(signal);
      const guest = await connect(id, credential, signal);
      await guest.upload(archive, signal);
      await guest.run('if [ ! -f ' + root + '/baseline ]; then mkdir -p ' + root + '/source && tar --no-same-owner --no-same-permissions -xzf /tmp/agent-os-source.tar.gz --strip-components=1 -C ' + root + '/source' +
        ' && cd ' + root + '/source && git init -q --template= && git add --force --all && git -c user.name=AgentOS -c user.email=workspace@localhost commit --allow-empty -qm source' +
        ' && git rev-parse HEAD > ' + root + '/baseline.tmp && mv ' + root + '/baseline.tmp ' + root + '/baseline; fi',
        { signal, timeoutMs: Math.max(1, attempt.deadline - Date.now()), retainOutput: false });
    },
    async wait(_key, credential, signal, journal) {
      const id = journal.read().providerId;
      if (!id) throw new Error('Workspace allocation is unavailable.');
      const guest = await connect(id, credential, signal);
      const command = shellArgument(config.command);
      const remaining = journal.deadline === undefined ? undefined : journal.deadline - Date.now();
      if (remaining !== undefined && remaining < 1000) throw new Error('Workspace deadline has elapsed.');
      const execute = remaining === undefined ? 'sh -c ' : 'timeout --kill-after=1s ' + Math.floor(remaining / 1000) + 's sh -c ';
      await guest.run(
        'if mkdir ' + root + '/started 2>/dev/null; then ' +
        'cd ' + root + '/source && { ' + execute + command + ' 2>&1; echo $? > ' + root + '/exit.tmp; }' +
        ' | { head -c 65536 > ' + root + '/logs; cat > /dev/null; }; mv ' + root + '/exit.tmp ' + root + '/exit; ' +
        'fi; while [ ! -f ' + root + '/exit ]; do sleep 1; done',
        { signal, timeoutMs: 0, retainOutput: false },
      );
    },
    async collect(_key, credential, signal, journal) {
      const id = journal.read().providerId;
      if (!id) throw new Error('Workspace allocation is unavailable.');
      const guest = await connect(id, credential, signal);
      const status = (await guest.read(root + '/exit', signal)).trim();
      if (!/^\d{1,3}$/.test(status)) throw new Error('Workspace command exit status is unavailable.');
      const diff = await guest.run('cd ' + root + '/source && git add --all && bash -o pipefail -c ' +
        '\'git diff --cached --binary --no-ext-diff --no-textconv "$(cat ' + root + '/baseline)" -- | { head -c 262145; cat >/dev/null; }\'',
        { signal, timeoutMs: 10_000 }) as { stdout?: string };
      const patch = diff.stdout;
      const oversized = patch !== undefined && Buffer.byteLength(patch) > 262_144;
      return { exitCode: Number(status), logs: await guest.read(root + '/logs', signal),
        ...(oversized ? { patchUnavailable: 'size_limit' } : { patch: patch || undefined }) };
    },
    async destroy(key, credential, signal, journal) {
      return allocation(key, credential, journal).destroy(signal);
    },
  };
}
