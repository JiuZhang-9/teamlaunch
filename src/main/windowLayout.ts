/**
 * 连锁的窗口位置记忆（2026-10-19 用户进阶需求："能否把每个窗口的位置和大小也记下来？"）。
 *
 * 现实约束（决定了实现长这样）：被打开的是**外部程序**，Electron 拿不到它的窗口——
 * 只能借助一次性的 PowerShell 调 user32。为了不依赖"我们自己启动的进程 id"（现在走
 * `shell.openPath`，压根拿不到 pid），匹配按**稳定的身份**做，两种都可靠：
 *   - 应用：按**可执行文件路径**匹配（`Process.MainModule.FileName`）；
 *   - 文件夹：按 Explorer 窗口的 **LocationURL** 匹配（`Shell.Application.Windows()`）。
 * 两者都不看窗口标题，所以中文/空格/重名都不影响判断。
 *
 * 三个刻意的边界：
 *  1. **手动记一次**：用户把窗口摆好、点「记住窗口布局」才记（不做后台巡逻、不持续跟踪）；
 *  2. **启动时应用**：只在连锁启动时对"记过的那一条"摆位，其余窗口一律不碰；
 *  3. **失败如实说**：PowerShell 被安全软件拦、窗口没出现、目标已失效 —— 都返回可展示的原因，
 *     绝不假装摆好了（连锁启动的结果提示里会带上）。
 *
 * IO 纪律：脚本与入参写临时文件、结果也经**文件**回读（不解析控制台输出）——
 * 控制台编码是 K-12 的老坑，绕开它比修它便宜。
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPlausibleWindowRect, type WindowRectLike } from '../shared/window-bounds.ts';

/** 存下来的窗口矩形（结构来自 shared 的纯判定类型，避免两处各写一份）。 */
export type WindowRect = WindowRectLike;

/** 一条连锁里"可以被摆位"的一步。 */
export interface LayoutStep {
  entryId: string;
  kind: 'app' | 'folder';
  /** 应用＝exe 路径；文件夹＝目录路径。 */
  target: string;
}

interface StoredStep extends WindowRect {
  kind: LayoutStep['kind'];
  target: string;
  savedAt: string;
}

interface LayoutFile {
  version: 1;
  chains: Record<string, { steps: Record<string, StoredStep> }>;
}

const FILE = path.join('config', 'window-layouts.json');
const PS = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
/** 等窗口出现的最长时间（冷启动慢的应用也要给足；超时就如实说没等到）。 */
const WAIT_MS = 12_000;

const EMPTY: LayoutFile = { version: 1, chains: {} };

function filePath(userData: string): string {
  return path.join(userData, FILE);
}

async function readLayouts(userData: string): Promise<LayoutFile> {
  try {
    const raw: unknown = JSON.parse(await readFile(filePath(userData), 'utf8'));
    if (raw === null || typeof raw !== 'object') return EMPTY;
    const chains = (raw as { chains?: unknown }).chains;
    if (chains === null || typeof chains !== 'object') return EMPTY;
    return { version: 1, chains: chains as LayoutFile['chains'] };
  } catch {
    return EMPTY;
  }
}

async function writeLayouts(userData: string, layouts: LayoutFile): Promise<void> {
  const full = filePath(userData);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(layouts, null, 2), 'utf8');
  await rename(tmp, full);
}

/**
 * 一次性 PowerShell 脚本：一把完成"读取"或"写入"。
 *
 * 入参/出参都走文件；脚本只吐出 exit code（0 = 跑到了终点，具体结果看 out 文件）。
 * 注意：脚本写成**纯 ASCII 注释**，并且落盘时带 UTF-8 BOM——PS 5.1 读无 BOM 的脚本会按
 * ANSI 代码页解，中文注释的字节可能把语法弄崩（第一次自验就栽在这：exit code 非 0，
 * 却被上层当成"系统不让调脚本"）。这两条都是能用机器防的，别靠记性。
 */
const SCRIPT = `
param([string]$Mode, [string]$InFile, [string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TlWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
}
"@
$spec = Get-Content -Raw -Encoding UTF8 $InFile | ConvertFrom-Json
$entries = @{}
$missing = New-Object System.Collections.ArrayList

function Get-ProcPath($p) {
  try { return $p.MainModule.FileName } catch { return $null }
}
function Find-AppWindow($exePath) {
  foreach ($p in Get-Process) {
    if ($p.MainWindowHandle -eq 0) { continue }
    $path = Get-ProcPath $p
    if ($null -ne $path -and ($path -ieq $exePath)) { return $p.MainWindowHandle }
  }
  return [IntPtr]::Zero
}
function Find-FolderWindow($url) {
  $shell = New-Object -ComObject Shell.Application
  foreach ($w in $shell.Windows()) {
    try {
      if ($null -ne $w.LocationURL -and ($w.LocationURL -ieq $url)) { return [IntPtr]$w.HWND }
    } catch { }
  }
  return [IntPtr]::Zero
}
function Resolve-Handle($step) {
  if ($step.kind -eq 'app') { return Find-AppWindow $step.target }
  if ($step.kind -eq 'folder') { return Find-FolderWindow $step.url }
  return [IntPtr]::Zero
}

foreach ($step in $spec.steps) {
  if ($Mode -eq 'capture') {
    $h = Resolve-Handle $step
    if ($h -eq [IntPtr]::Zero) { [void]$missing.Add($step.entryId); continue }
    $r = New-Object 'TlWin+RECT'
    if (-not [TlWin]::GetWindowRect($h, [ref]$r)) { [void]$missing.Add($step.entryId); continue }
    $rect = @{ x = $r.Left; y = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top) }
    $entries[$step.entryId] = $rect
  } else {
    # apply: poll until the window shows up (cold start varies a lot), then place it
    $deadline = (Get-Date).AddMilliseconds($spec.waitMs)
    $h = [IntPtr]::Zero
    while ((Get-Date) -lt $deadline) {
      $h = Resolve-Handle $step
      if ($h -ne [IntPtr]::Zero) { break }
      Start-Sleep -Milliseconds 400
    }
    if ($h -eq [IntPtr]::Zero) { [void]$missing.Add($step.entryId); continue }
    $moved = [TlWin]::MoveWindow($h, [int]$step.rect.x, [int]$step.rect.y, [int]$step.rect.width, [int]$step.rect.height, $true)
    if (-not $moved) { [void]$missing.Add($step.entryId) }
    else { $entries[$step.entryId] = $step.rect }
  }
}
@{ ok = $true; entries = $entries; missing = @($missing) } | ConvertTo-Json -Depth 6 -Compress | Out-File -Encoding UTF8 -FilePath $OutFile
`;

/** 把一条文件夹路径转成 Explorer 认得的 file:/// URL（与 LocationURL 比较用）。 */
function folderUrl(target: string): string {
  const win = target.replace(/\\/g, '/');
  return `file:///${win.replace(/^\/+/, '')}`;
}

interface PsResult {
  ok: boolean;
  entries?: Record<string, WindowRect>;
  missing?: string[];
}

/** 跑一次脚本；失败返回**可展示的原因**（PS 缺失 / 语法错 / 超时 / 被策略拦），不猜。 */
async function runScript(
  mode: 'capture' | 'apply',
  spec: unknown,
  timeoutMs: number,
): Promise<{ ok: true; data: PsResult } | { ok: false; error: string }> {
  const dir = path.join(tmpdir(), 'tl-winlayout');
  const inFile = path.join(dir, `${mode}-${process.pid}-in.json`);
  const outFile = path.join(dir, `${mode}-${process.pid}-out.json`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(inFile, JSON.stringify(spec), 'utf8');
    const scriptFile = path.join(dir, `tl-winlayout-${process.pid}.ps1`);
    /* 带 BOM 落盘：PS 5.1 对无 BOM 的脚本按 ANSI 代码页解码（见 SCRIPT 上方注释）。 */
    await writeFile(scriptFile, `\ufeff${SCRIPT}`, 'utf8');
    const failure = await new Promise<string | null>((resolve) => {
      execFile(
        PS,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-Mode', mode, '-InFile', inFile, '-OutFile', outFile],
        { timeout: timeoutMs, windowsHide: true },
        (err, _stdout, stderr) => {
          if (err === null) {
            resolve(null);
            return;
          }
          /* 把真实原因带出来（截断到一行）：这一层最容易被误报成"系统不让调"，其实可能只是脚本写坏了。 */
          const detail = `${err.message} ${stderr ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 160);
          resolve(detail.length > 0 ? detail : 'PowerShell 执行失败');
        },
      );
    });
    if (failure !== null) return { ok: false, error: failure };
    /* Out-File -Encoding UTF8 在 PS 5.1 会写 BOM，JSON.parse 不认 —— 去掉再解析。 */
    const text = (await readFile(outFile, 'utf8')).replace(/^\uFEFF/, '');
    return { ok: true, data: JSON.parse(text) as PsResult };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await rm(inFile, { force: true }).catch(() => undefined);
    await rm(outFile, { force: true }).catch(() => undefined);
  }
}

export interface CaptureResult {
  saved: number;
  missing: string[];
  reason?: string;
}

/**
 * 记一次布局：把当前这些步骤对应窗口的位置与大小存进 `config/window-layouts.json`。
 * 窗口没开着的步骤会进 missing（界面据此提示"先把窗口都开出来再记"）。
 */
export async function captureLayout(userData: string, chainId: string, steps: LayoutStep[]): Promise<CaptureResult> {
  const usable = steps.filter((s) => s.target.trim().length > 0);
  if (usable.length === 0) return { saved: 0, missing: [], reason: '这条连锁里没有可以记位置的应用或文件夹' };
  const res = await runScript(
    'capture',
    { steps: usable.map((s) => ({ entryId: s.entryId, kind: s.kind, target: s.target, url: folderUrl(s.target) })) },
    15_000,
  );
  if (!res.ok) {
    return { saved: 0, missing: usable.map((s) => s.entryId), reason: `记窗口位置失败：${res.error}` };
  }
  const entries = res.data.entries ?? {};
  const layouts = await readLayouts(userData);
  const chain = layouts.chains[chainId] ?? { steps: {} };
  const now = new Date().toISOString();
  const rejected: string[] = [];
  for (const step of usable) {
    const rect = entries[step.entryId];
    if (rect === undefined) continue;
    /* 最小化窗口报的是 -32000/-32000 + 只剩标题栏的尺寸：不记，宁可让用户"展开再记一次"，
       也不能把"最小化"当成布局记下来（next launch 会把它再次最小化）。 */
    if (!isPlausibleWindowRect(rect)) {
      rejected.push(step.entryId);
      continue;
    }
    chain.steps[step.entryId] = { ...rect, kind: step.kind, target: step.target, savedAt: now };
  }
  layouts.chains[chainId] = chain;
  await writeLayouts(userData, layouts);
  const saved = Object.keys(entries).length - rejected.length;
  return {
    saved,
    missing: [...new Set([...(res.data.missing ?? []), ...rejected])],
    reason:
      saved === 0
        ? '这些窗口现在没有开着或处于最小化——先把它们打开、摆好位置，再点一次记住'
        : rejected.length > 0
          ? '有窗口是最小化的，已跳过（展开后再记一次）'
          : undefined,
  };
}

/** 这条连锁记过几条。 */
export async function layoutCount(userData: string, chainId: string): Promise<number> {
  const layouts = await readLayouts(userData);
  return Object.keys(layouts.chains[chainId]?.steps ?? {}).length;
}

export async function clearLayout(userData: string, chainId: string): Promise<boolean> {
  const layouts = await readLayouts(userData);
  if (layouts.chains[chainId] === undefined) return false;
  delete layouts.chains[chainId];
  await writeLayouts(userData, layouts);
  return true;
}

/**
 * 摆一条窗口（连锁启动的每一步调用一次）。
 * 记过才摆、没记过直接返回 `skipped`——不打扰"没打算记位置"的应用。
 */
export async function applyLayout(userData: string, chainId: string, entryId: string): Promise<{ ok: boolean; reason?: string }> {
  const layouts = await readLayouts(userData);
  const step = layouts.chains[chainId]?.steps[entryId];
  if (step === undefined) return { ok: true, reason: 'skipped' };
  // 旧文件里可能存着"最小化时的 -32000"这种垃圾：不摆，直接说清楚让它重新记。
  if (!isPlausibleWindowRect(step)) {
    return { ok: false, reason: '这条记住的位置无效（多半是记的时候窗口最小化了），请重新记一次' };
  }
  const res = await runScript(
    'apply',
    {
      waitMs: WAIT_MS,
      steps: [{ entryId, kind: step.kind, target: step.target, url: folderUrl(step.target), rect: { x: step.x, y: step.y, width: step.width, height: step.height } }],
    },
    WAIT_MS + 8000,
  );
  if (!res.ok) return { ok: false, reason: `位置没能恢复：${res.error}` };
  const ok = res.data.entries !== undefined && res.data.entries[entryId] !== undefined;
  return ok ? { ok: true } : { ok: false, reason: '没等到这个窗口出现，位置没能恢复' };
}
