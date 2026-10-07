#!/usr/bin/env node
/** 探测:空 .exe 文件的 getFileIcon 是否稳定返回"默认应用程序图"(作为运行时判定基准)。 */
import { app } from 'electron';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

app.whenReady().then(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tl-basis-'));
  for (const [name, content] of [
    ['basis-empty.exe', Buffer.alloc(0)],
    ['basis-garbage.exe', Buffer.from('not a real exe')],
  ]) {
    const p = path.join(dir, name);
    await writeFile(p, content);
    try {
      const icon = await app.getFileIcon(p, { size: 'large' });
      const url = icon.toDataURL();
      console.log(`${name}: len=${url.length} head=${url.slice(0, 22)}`);
      const b64 = url.slice(url.indexOf(',') + 1);
      await writeFile(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
    } catch (e) {
      console.log(`${name}: ERROR ${e.message.slice(0, 60)}`);
    }
  }
  console.log('outdir:', dir);
  app.quit();
});
