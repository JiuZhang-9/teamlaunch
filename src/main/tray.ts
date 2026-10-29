/**
 * 托盘常驻（P0-12）：打开 / 刷新 / 退出。
 * 托盘图标用本机资源，不走网络；菜单文案与 UI 口径一致（说「打开主窗口」不说「唤醒」）。
 * "退出"走 app.quit()——退出标记（lifecycle.markQuitting）会让 palette 放行 close，
 * 退出因此真正完成，而不是像过去那样被面板窗口无声取消。
 */
import { dialog, Menu, Tray, app, nativeImage } from 'electron';
import path from 'node:path';
import { showMainWindow, showPalette } from './windowManager.ts';

let tray: Tray | null = null;

/** 幂等：设置开关每次 patch 都会调 syncTray()，已存在时不得重复创建图标。 */
export function createTray(actions: { refresh(): void }): Tray | null {
  if (tray) return tray;

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray.ico')
    : path.join(app.getAppPath(), 'build', 'tray.ico');

  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  const profile = process.env.TL_PROFILE?.trim();
  tray.setToolTip(profile && profile !== 'default' ? `TeamLaunch（${profile}）` : 'TeamLaunch');

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      /* 统一走 showMainWindow：先收快捷窗口，保证两面不同时可见（2026-10-27，1.2.0）。 */
      click: () => showMainWindow(),
    },
    // 不标注键位：唤起热键可在设置里改键，写死标注就是撒谎（用户明确指出）。
    { label: '唤起搜索', click: () => showPalette() },
    { label: '刷新团队入口', click: () => actions.refresh() },
    { type: 'separator' },
    {
      /* 2026-10-29 用户要求：故障时快速重启刷新状态。
         重启走正常退出流程（before-quit 会 markQuitting + 停服务），再由 Electron 拉起同参数新实例。
         未发布的团队草稿只在内存里，必须确认一次，不能假装它能保留。 */
      label: '重启',
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['重启', '取消'],
          /* 默认落在「取消」：误按回车不该把未发布的草稿弄丢。 */
          defaultId: 1,
          cancelId: 1,
          title: '重启 TeamLaunch',
          message: '确定重启 TeamLaunch 吗？',
          detail: '未发布的团队改动只保存在内存里，重启后会丢失。',
        });
        if (choice !== 0) return;
        app.relaunch();
        app.quit();
      },
    },
    { label: '退出', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    showMainWindow();
  });
  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
