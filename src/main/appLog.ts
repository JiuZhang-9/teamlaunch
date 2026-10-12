/**
 * 主进程的极简落盘日志（best-effort）。
 *
 * 为什么需要它：自动更新这条链路以前完全不可观测 —— electron-updater 的 logger 在
 * 生产环境被设成 null（它内部换成 NoOpLogger），我们自己的 log() 只在 TL_UPD_DEBUG=1
 * 时输出 console，而 GUI 进程的 console 没人看得见。2026-10-12 排查员工端"更新提示
 * 弹一下就没动静"时，只能靠反推 electron-updater 源码定位（根因是老安装包缺
 * resources/app-update.yml，下载在建缓存目录前抛 ENOENT 被静默吞掉）。
 *
 * 纪律：
 *  - best-effort：写不进去（目录只读、磁盘满）也不许抛错、不许影响调用方；
 *  - 不做轮转：目前只有更新器在写，量极小；真要涨起来再加（目录约定见 paths.ts）。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

function render(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part instanceof Error) return part.stack ?? `${part.name}: ${part.message}`;
  try {
    return JSON.stringify(part) ?? String(part);
  } catch {
    return String(part);
  }
}

/** 追加一行日志：`<ISO 时间> [scope] 内容…`。永不抛、永不阻塞调用方。 */
export function logLine(scope: string, ...parts: unknown[]): void {
  const line = `${new Date().toISOString()} [${scope}] ${parts.map(render).join(' ')}\n`;
  void (async () => {
    try {
      const dir = join(app.getPath('userData'), 'logs');
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'main.log'), line, 'utf8');
    } catch {
      // 日志写不进去不是故障：绝不因为它改变程序行为
    }
  })();
}
