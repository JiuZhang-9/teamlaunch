/**
 * src/platform/process-runner.ts —— 外部命令执行的唯一出口（K-04 / K-05）
 *
 * 两条硬规则：
 *   1. 禁止 exec、禁止 shell:true —— 路径含空格/中文/特殊字符会被二次解析，
 *      最坏是命令注入。一律 spawn + 数组传参 + shell:false。
 *   2. 必须带超时 ——UNC 下线路径上的子进程可能永远不返回（K-05），
 *      超时后主动 kill，不让主进程被拖住。
 */

import { spawn } from 'node:child_process';
import { SPAWN_TIMEOUT_MS } from '../shared/constants.ts';

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** 无法启动（命令不存在 / 权限不足）时为 true。 */
  spawnFailed: boolean;
}

const MAX_OUTPUT_BYTES = 256 * 1024;

export function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number = SPAWN_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      // kill 之后再等一小段让 close 触发；超时路径本身不能被拖死。
      setTimeout(() => finish({ exitCode: null, stdout, stderr, timedOut, spawnFailed: false }), 200);
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk;
    });
    child.on('error', () => {
      finish({ exitCode: null, stdout, stderr, timedOut, spawnFailed: true });
    });
    child.on('close', (code) => {
      finish({ exitCode: code, stdout, stderr, timedOut, spawnFailed: false });
    });
  });
}
