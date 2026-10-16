/**
 * 界面显示的应用版本号（唯一出处）。
 *
 * 为什么不直接用构建期常量 `__APP_VERSION__`：它取自打包时读到的 package.json，一旦
 * "产物没重建就打包"（例如为了改输出目录直接调 electron-builder、跳过 npm run build），
 * 界面会显示旧版本而程序本体是新版本——2026-10-17 真实发生过一次。
 * 现在优先用主进程下发的运行版本（webPreferences.additionalArguments → preload），
 * 只有拿不到时（浏览器预览 Harness 没有 preload）才回落到构建期常量。
 */
import { api } from '../bridge/index.ts';

export const APP_VERSION: string = api.appVersion !== '' ? api.appVersion : __APP_VERSION__;
