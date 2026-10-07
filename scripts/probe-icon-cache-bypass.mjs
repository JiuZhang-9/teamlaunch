#!/usr/bin/env node
/** 探测:getFileIcon 的各种路径形态是否能绕过损坏的图标缓存条目;结果存 PNG 供目检。 */
import { app } from 'electron';
import { writeFile, mkdtemp, link, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXE = '${process.env.LOCALAPPDATA}\\ima.copilot\\Application\\ima.copilot.exe';

app.whenReady().then(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tl-icon-probe-'));
  const save = async (name, dataUrl) => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      console.log(`${name}: NOT-IMAGE (${String(dataUrl).slice(0, 40)})`);
      return;
    }
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await writeFile(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
    console.log(`${name}: ${dataUrl.length}B -> ${name}.png`);
  };

  // 0. 原路径(基准,预期=坏缓存默认图)
  await save('plain_large', (await app.getFileIcon(EXE, { size: 'large' })).toDataURL());

  // 1. \\?\ 前缀(绕 shell 规范化/缓存命中)
  try {
    await save('verbatim_large', (await app.getFileIcon('\\\\?\\' + EXE, { size: 'large' })).toDataURL());
  } catch (e) {
    console.log('verbatim ERROR:', e.message.slice(0, 80));
  }

  // 2. 硬链接副本(不同路径,缓存必未命中)
  try {
    const hard = path.join(dir, 'ima-copy.exe');
    await link(EXE, hard);
    await save('hardlink_large', (await app.getFileIcon(hard, { size: 'large' })).toDataURL());
  } catch (e) {
    console.log('hardlink ERROR:', e.message.slice(0, 80));
  }

  // 3. 正斜杠形态
  try {
    await save('fwdslash_large', (await app.getFileIcon(EXE.replace(/\\/g, '/')), { size: 'large' }).toDataURL?.() ?? null);
  } catch (e) {
    console.log('fwdslash ERROR:', e.message.slice(0, 80));
  }

  console.log('outdir:', dir);
  app.quit();
});
