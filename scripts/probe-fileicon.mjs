#!/usr/bin/env node
/** 临时探测:三个用户提供的 exe 在 app.getFileIcon 下的真实表现(耗时/空图标/异常)。 */
import { app } from 'electron';

const PATHS = [
  'D:\\Program Files\\Obsidian\\Obsidian.exe',
  '${process.env.LOCALAPPDATA}\\ima.copilot\\Application\\ima.copilot.exe',
  'D:\\Program Files\\PureRef\\PureRef.exe',
];

app.whenReady().then(async () => {
  for (const p of PATHS) {
    for (const size of ['large', 'small']) {
      const t0 = Date.now();
      try {
        const icon = await app.getFileIcon(p, { size });
        const url = icon.toDataURL();
        console.log(
          `${p} [${size}] ${Date.now() - t0}ms empty=${icon.isEmpty()} len=${url.length} head=${url.slice(0, 22)}`,
        );
      } catch (e) {
        console.log(`${p} [${size}] ${Date.now() - t0}ms ERROR: ${e.message}`);
      }
    }
  }
  app.quit();
});
