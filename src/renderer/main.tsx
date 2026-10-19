/**
 * 渲染层入口。
 *
 * 只使用 Electron preload 注入的 `window.tl`——**没有预览模式、没有 mock 宿主**。
 *
 * 曾经这里会在浏览器里注入一套 mock，好让界面能在网页中显示。
 * 代价是打包后的程序一旦 preload 没加载上，就静默变成"演示版"，
 * 把"功能全废"伪装成"产品本来就这样"。那套东西已彻底删除。
 *
 * 渲染层任何文件都不得 import electron（eslint no-restricted-imports）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App.tsx';
import { PaletteRoot } from './pages/PaletteRoot.tsx';

const host = document.getElementById('root');
if (!host) throw new Error('找不到挂载点 #root');

/**
 * 窗口路由：主进程给迷你面板窗口的 URL 带 `#/palette`。
 * 此前这里无视 hash，把完整主界面渲染进 560×420 的面板窗口——
 * 内容被 minWidth 裁切、热键"调出第二个主窗口"就是这条缺失路由的下游症状。
 */
const isPalette = window.location.hash.startsWith('#/palette');

/* 拖拽防误导航（2026-10-19）：把文件拖进窗口时，若某个位置没有处理 drop，
   Chromium 默认会**导航到这个 file:// 地址**——窗口被换成文件内容/空白，只能重启。
   主窗口的投放逻辑自己会 preventDefault；这里兜住"没接住"的所有位置（含面板窗口）。 */
window.addEventListener('dragover', (e) => {
  if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
});

createRoot(host).render(
  <StrictMode>{isPalette ? <PaletteRoot /> : <App />}</StrictMode>,
);
