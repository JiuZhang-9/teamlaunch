/**
 * SettingsPanel —— 设置对话框（2026-10-03 重构：左侧栏四分区，不再单列长滚动）。
 *
 * 分区：通用（外观/主题色/启动/托盘/缩放/使用数据）｜快捷键｜高级（管理员模式）｜关于。
 * 左侧栏不收起（用户明确要求）；分区高度差异由内容列自身滚动吸收。
 *
 * 头号红线：**遥测开关必须一级可见、不折叠**（PRD §15.3）——它是「通用」页第一行，
 * 而「通用」是打开设置的默认落点；塞进"高级"等于没有这个开关。
 * 关闭遥测立即生效，不弹二次确认（AC-18）。
 */
import {
  Copy,
  FolderOpen,
  Info,
  Keyboard,
  KeyRound,
  Monitor,
  PenLine,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { Switch } from '../atoms/Switch.tsx';
import { BrandMark } from '../atoms/BrandMark.tsx';
import { ScrollArea } from '../atoms/ScrollArea.tsx';
import { Segmented } from '../molecules/Segmented.tsx';
import { ThemePicker } from '../molecules/ThemePicker.tsx';
import { Dialog } from './Dialog.tsx';
import { AppHotkeysSection } from './AppHotkeysSection.tsx';
import type { SettingsSection } from '../../store/workbenchStore.tsx';
import type { Settings } from '../../../shared/schema/local.ts';
import { api } from '../../bridge/index.ts';
import { APP_VERSION } from '../../lib/appVersion.ts';
import type { AdminStatus, AppUpdateStatus, BrowserInfo } from '../../bridge/types.ts';
import { updateStatusLine as statusLine } from '../../../shared/update-copy.ts';
import { acceleratorOf, normalizeAcceleratorInput } from '../../../shared/app-hotkeys.ts';
import { formatRevDate } from './EditActionBar.tsx';

export type ZoomLevel = 90 | 100 | 105 | 110;
export type ChainInterval = 500 | 800 | 1500 | 3000;

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'hotkeys', label: '快捷键', icon: Keyboard },
  { id: 'advanced', label: '高级', icon: Wrench },
  { id: 'about', label: '关于', icon: Info },
];

/** 主题色预设（定稿 2026-10-02）：第一个是品牌青蓝默认值；粉/橙为用户点名保留项。 */
// eslint-disable-next-line no-restricted-syntax -- 这些 hex 是"用户可选的数据选项"，不是样式引用；样式一律走 --accent* 派生变量。
const ACCENT_PRESETS = ['#106696', '#db2777', '#ea580c', '#12805c', '#0284c7', '#6d5ae0', '#c2344a', '#b45309'] as const;

/**
 * 更新状态的一句话（关于页状态行）。
 * 文案本体在 `shared/update-copy.ts`——工作区小窗也要说同一句话，两处必须一字不差。
 */
const updateStatusLine = statusLine;

export interface SettingsPanelProps {
  settings: Settings;
  onPatch(p: Partial<Settings>): void;
  onClose(): void;
  onViewPrivacy(): void;
  /** 界面缩放百分比（80–150）。浏览器式 zoom，窗口不变内容等比缩放。 */
  zoom: number;
  onZoom(z: number): void;
  onCopyDeviceId(): void;
  /** 设置·关于 →「查看更新日志」（读随包的 CHANGELOG.md 渲染）。 */
  onOpenChangelog(): void;
  /** 真实的管理员口令/角色状态（api.admin.status），由视图层查询与刷新。 */
  adminStatus: AdminStatus | null;
  /** 本机角色的即时值（settings.role）：开关直接反映用户意图，不等异步重装完成。 */
  roleAdmin: boolean;
  /** 开启/关闭管理员模式（关=停本机同步服务，视图层负责确认）。 */
  onToggleAdmin(next: boolean): void;
  /** 设置口令（未设置）或修改口令（已设置），视图层弹对应对话框。 */
  onSetOrChangePassphrase(): void;
  /** 打开更新分发目录（管理员把构建产物放进来，全团队自动更新）。 */
  onOpenUpdatesFolder(): void;
  /** 手动检查应用更新（关于页「检查更新」）。 */
  onCheckUpdate(): void;
  /** 检查进行中：按钮转圈并禁止重复点。 */
  updateChecking?: boolean;
  /** 更新器状态快照（关于页状态行）；null = 还没读到。 */
  updateStatus: AppUpdateStatus | null;
  /** AC-05：注册失败才提示，本次会话只提示一次，不得反复弹窗 */
  hotkeyConflict?: boolean;
  teamRevision: number | null;
  /** 真实设备标识（identity.json），不再是写死的演示值。 */
  deviceId: string;
  /** 最近一次发布时间（关于页给团队数据版本加可记忆的日期）。 */
  announcedAt?: string | null;
  /** 外部指定的落点分区（标题栏版本号 → about；热键横幅 → hotkeys）。 */
  initialSection: SettingsSection;
}

function Row({
  title,
  detail,
  control,
}: {
  title: string;
  detail?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="flex min-h-[var(--row-h)] items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="t-base w-emph text-[var(--fg)]">{title}</p>
        {detail && <p className="t-xs mt-0.5 text-[var(--muted)]">{detail}</p>}
      </div>
      {control}
    </div>
  );
}

function SectionHead({ children }: { children: ReactNode }) {
  return <p className="t-xs w-emph mb-2 text-[var(--muted)]">{children}</p>;
}

function Divider() {
  return <div className="my-2 h-px w-full bg-[var(--border-subtle)]" />;
}

export function SettingsPanel({
  settings, onPatch, onClose, onViewPrivacy, zoom, onZoom, onCopyDeviceId, onOpenChangelog,
  adminStatus, roleAdmin, onToggleAdmin, onSetOrChangePassphrase, onOpenUpdatesFolder,
  onCheckUpdate, updateChecking = false, updateStatus, announcedAt,
  hotkeyConflict = false, teamRevision, deviceId, initialSection,
}: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [recording, setRecording] = useState(false);
  /** 「手动输入」面板：null = 收起；字符串 = 正在编辑的组合键写法（2026-10-19）。 */
  const [manualHotkey, setManualHotkey] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  /** 本机已装浏览器（切到「通用」时扫一次；扫描失败就只剩"系统默认"这一项）。 */
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);

  useEffect(() => {
    if (section !== 'general') return;
    let cancelled = false;
    void api.browsers
      .list()
      .then((list) => {
        if (!cancelled) setBrowsers(list);
      })
      .catch(() => {
        if (!cancelled) setBrowsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  /** 手动指定浏览器（主进程会把 .lnk 解析成真实 exe；取消不算失败）。 */
  const pickBrowser = async (): Promise<void> => {
    const picked = await api.entries.pick('app');
    if (!picked.ok) return;
    void onPatch({ browserExe: picked.target });
  };
  const hotkeyRef = useRef<HTMLInputElement | null>(null);
  const acked = settings.telemetryNoticeAckedAt !== null;

  useEffect(() => {
    if (recording) hotkeyRef.current?.focus();
  }, [recording]);

  const hotkeyText = recording
    ? '按下新的热键…'
    : settings.hotkey === 'none'
      ? '未设置'
      : settings.hotkey;

  return (
    <Dialog
      title="设置"
      width="xwide"
      onClose={onClose}
      /* 高度恒定（560）：切页不再改变窗口大小；内容超出由内容列的 ScrollArea 吸收
         （滚动时显示、停 800ms 淡出，与卡片页同一交互）。小窗口下 flex 收缩兜底。 */
      bodyClassName="flex h-[560px] min-h-0 overflow-hidden"
    >
      {/* 左侧栏：固定不收起；tablist 语义供读屏定位当前页 */}
      <nav
        role="tablist"
        aria-label="设置分区"
        className="w-[164px] shrink-0 border-r border-[var(--border-subtle)] p-2"
      >
        {SECTIONS.map((s) => {
          const selected = s.id === section;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`tl-settings-tab-${s.id}`}
              aria-selected={selected}
              aria-controls={`tl-settings-panel-${s.id}`}
              onClick={() => setSection(s.id)}
              className={[
                'flex h-9 w-full items-center gap-2 rounded-[var(--radius-md)] px-3 t-sm',
                'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
              ].join(' ')}
              style={{
                background: selected ? 'var(--tab-bg-selected)' : 'transparent',
                color: selected ? 'var(--fg)' : 'var(--fg-2)',
              }}
            >
              <s.icon size={16} strokeWidth={2} aria-hidden />
              {s.label}
            </button>
          );
        })}
      </nav>

      <div
        role="tabpanel"
        id={`tl-settings-panel-${section}`}
        aria-labelledby={`tl-settings-tab-${section}`}
        className="min-h-0 min-w-0 flex-1"
      >
        <ScrollArea className="h-full" ariaLabel="设置内容">
          <div className="px-[var(--space-6)] pb-4 pt-2">
            {section === 'general' && (
          <>
            {/* 第 1 项：遥测开关，一级可见（PRD §15.3） */}
            <Row
              title="使用数据统计"
              detail={
                <span className="block">
                  {!acked
                    ? '尚未确认隐私说明，暂不记录任何数据'
                    : settings.telemetryEnabled
                      ? '正在记录匿名使用数据'
                      : '关闭后不再记录任何数据'}
                  {acked && !settings.telemetryEnabled && (
                    <span className="block t-2xs text-[var(--meta)]">
                      已停止记录并清空本机待发送数据
                    </span>
                  )}
                  {!acked && (
                    <Button size="sm" tone="secondary" className="mt-1" onClick={onViewPrivacy}>
                      查看隐私说明
                    </Button>
                  )}
                </span>
              }
              control={
                <Switch
                  ariaLabel="使用数据统计"
                  checked={acked && settings.telemetryEnabled}
                  disabled={!acked}
                  onChange={(next) => onPatch({ telemetryEnabled: next })}
                />
              }
            />

            <Divider />
            <SectionHead>外观</SectionHead>
            <ThemePicker value={settings.theme} onChange={(v) => onPatch({ theme: v })} />

            {/*
             * 主题色（定稿 2026-10-02）：8 预设 + 色盘自选；只用于点缀位（选中竖条/tint 底、
             * Logo、卡片左缘条、focus 环、开关、徽标），画布/卡片/正文永远中性灰。
             */}
            <div className="mt-2 flex items-center gap-2">
              <span className="t-xs text-[var(--muted)]">主题色</span>
              {ACCENT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`主题色 ${hex}`}
                  aria-pressed={settings.accentColor.toLowerCase() === hex || undefined}
                  onClick={() => onPatch({ accentColor: hex })}
                  className="h-5 w-5 shrink-0 cursor-pointer rounded-[var(--radius-pill)] transition-transform duration-[var(--motion-fast)] hover:scale-110"
                  style={{
                    background: hex,
                    boxShadow: settings.accentColor.toLowerCase() === hex
                      ? '0 0 0 2px var(--bg-surface), 0 0 0 3.5px var(--fg)'
                      : '0 0 0 1px var(--border-strong)',
                  }}
                />
              ))}
              <label
                className="ml-1 grid h-6 w-6 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-strong)]"
                title="自定义主题色"
              >
                <input
                  type="color"
                  aria-label="自定义主题色"
                  value={settings.accentColor}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) onPatch({ accentColor: v });
                  }}
                  className="h-8 w-8 cursor-pointer border-0 bg-transparent p-0"
                />
              </label>
            </div>

            <Row
              title="开机自动启动"
              control={
                <Switch
                  ariaLabel="开机自动启动"
                  checked={settings.autoLaunch}
                  onChange={(next) => onPatch({ autoLaunch: next })}
                />
              }
            />
            <Row
              title="关闭主窗口时最小化到托盘"
              control={
                <Switch
                  ariaLabel="关闭主窗口时最小化到托盘"
                  checked={settings.trayEnabled}
                  onChange={(next) => onPatch({ trayEnabled: next })}
                />
              }
            />

            <Row
              title="主页公告提醒"
              detail="管理员发布新公告时，右下角提示一次（每篇只提示一次）；关掉后主页上仍然能看"
              control={
                <Switch
                  ariaLabel="主页公告提醒"
                  checked={settings.announcementNotify}
                  onChange={(next) => onPatch({ announcementNotify: next })}
                />
              }
            />

            <Divider />
            <SectionHead>UI 缩放</SectionHead>
            <p className="t-2xs mb-2 text-[var(--meta)]">放大字体与界面元素，窗口大小不变；主窗口立即生效并记住选择</p>
            <Segmented
              label="UI 缩放"
              value={zoom}
              onChange={onZoom}
              options={[
                { value: 90 as ZoomLevel, label: '90%' },
                { value: 100 as ZoomLevel, label: '100%' },
                { value: 105 as ZoomLevel, label: '105%' },
                { value: 110 as ZoomLevel, label: '110%' },
              ]}
            />

            <Divider />
            <SectionHead>网页打开方式</SectionHead>
            <p className="t-2xs mb-2 text-[var(--meta)]">
              默认跟随系统。指定后所有网页入口都用它打开；它不在了会自动回落系统默认并提示（不会静默换掉）
            </p>
            <div className="flex items-center gap-2">
              <select
                aria-label="打开网页的浏览器"
                value={settings.browserExe ?? ''}
                onChange={(e) => void onPatch({ browserExe: e.target.value === '' ? null : e.target.value })}
                className="h-8 min-w-0 max-w-[320px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 t-sm text-[var(--fg)]"
              >
                <option value="">系统默认浏览器</option>
                {browsers.map((b) => (
                  <option key={b.path} value={b.path}>
                    {b.name}
                    {b.isDefault ? '（系统默认）' : ''}
                  </option>
                ))}
                {/* 已指定但这次没扫到（被卸载/移动）也要列出来：否则下拉会静默跳回"系统默认"，
                    看起来像用户的选择被改了（其实没有）。 */}
                {settings.browserExe !== null && !browsers.some((b) => b.path === settings.browserExe) && (
                  <option value={settings.browserExe}>{settings.browserExe}</option>
                )}
              </select>
              <Button tone="ghost" size="sm" className="shrink-0" onClick={() => void pickBrowser()}>
                浏览…
              </Button>
            </div>

            <Divider />
            <SectionHead>全局快捷窗口</SectionHead>
            <p className="t-2xs mb-2 text-[var(--meta)]">
              面板的不透明度：调低后能透出身后的窗口，方便边看边操作；只影响快捷窗口，不动主窗口
            </p>
            <Segmented
              label="快捷窗口不透明度"
              value={settings.paletteOpacity}
              onChange={(v) => onPatch({ paletteOpacity: v })}
              options={[
                { value: 100, label: '100%' },
                { value: 95, label: '95%' },
                { value: 90, label: '90%' },
                { value: 85, label: '85%' },
                { value: 80, label: '80%' },
              ]}
            />

            <Divider />
            <SectionHead>连锁启动</SectionHead>
            <p className="t-2xs mb-2 text-[var(--meta)]">
              多选模式下点「启动连锁」后，每个入口之间的等待时间（某一步打不开会跳过并在最后提示）
            </p>
            <Segmented
              label="连锁启动间隔"
              value={settings.chainIntervalMs}
              onChange={(v) => onPatch({ chainIntervalMs: v })}
              options={[
                { value: 500 as ChainInterval, label: '0.5 秒' },
                { value: 800 as ChainInterval, label: '0.8 秒' },
                { value: 1500 as ChainInterval, label: '1.5 秒' },
                { value: 3000 as ChainInterval, label: '3 秒' },
              ]}
            />
          </>
        )}

        {section === 'hotkeys' && (
          <>
            <SectionHead>全局快捷搜索热键</SectionHead>
            <div className="flex items-center gap-2">
              {/* Input 原子恒为 w-full，宽度类会被压掉：固定宽必须由外层包裹层给足并钉死。 */}
              <div className="w-[200px] shrink-0">
                <Input
                  ref={hotkeyRef}
                  readOnly
                  mono
                  value={hotkeyText}
                  aria-label="全局快捷搜索热键"
                  onKeyDown={(e) => {
                  if (!recording) return;
                  e.preventDefault();
                  if (e.key === 'Escape') {
                    setRecording(false);
                    return;
                  }
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    onPatch({ hotkey: 'none' });
                    setRecording(false);
                    return;
                  }
                  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
                  /* 归一走共享实现（shared/app-hotkeys.ts）：空格必须写成 `Space`，
                     否则存进去的是 `Ctrl+ `，全局注册与窗口内匹配都永远失败。 */
                  const accel = acceleratorOf(e);
                  if (accel === null) return;
                  onPatch({ hotkey: accel });
                  setRecording(false);
                }}
                />
              </div>
              <Button tone="secondary" icon={Keyboard} className="shrink-0 whitespace-nowrap" onClick={() => setRecording(true)}>
                重新录制
              </Button>
              {/* 「手动输入」（2026-10-19 用户反馈"Ctrl+空格确实录不进去"）：
                  有些组合键会被输入法在系统层先吃掉，应用收不到 keydown（任何程序都一样），
                  录制器再准也录不到。给一个直接写出来的口子：输入 Ctrl+Space 回车即生效。 */}
              <Button
                tone="ghost"
                icon={PenLine}
                className="shrink-0 whitespace-nowrap"
                onClick={() => {
                  setManualHotkey(settings.hotkey === 'none' ? '' : settings.hotkey);
                  setManualError(null);
                }}
              >
                手动输入
              </Button>
            </div>
            {manualHotkey !== null && (
              <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2">
                <p className="t-2xs mb-1 text-[var(--meta)]">
                  直接写组合键（例如 <span className="t-mono">Ctrl+Space</span>、<span className="t-mono">Ctrl+Alt+K</span>），回车保存：
                  输入法先吃掉的键只能这样设。
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    mono
                    value={manualHotkey}
                    aria-label="手动输入全局热键"
                    placeholder="Ctrl+Space"
                    onChange={(e) => {
                      setManualHotkey(e.target.value);
                      setManualError(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') {
                        setManualHotkey(null);
                        return;
                      }
                      if (e.key !== 'Enter') return;
                      const parsed = normalizeAcceleratorInput(manualHotkey);
                      if (parsed.value === null) {
                        setManualError(parsed.reason ?? '这个写法不认识');
                        return;
                      }
                      onPatch({ hotkey: parsed.value });
                      setManualHotkey(null);
                    }}
                  />
                  <Button
                    tone="primary"
                    className="shrink-0"
                    onClick={() => {
                      const parsed = normalizeAcceleratorInput(manualHotkey);
                      if (parsed.value === null) {
                        setManualError(parsed.reason ?? '这个写法不认识');
                        return;
                      }
                      onPatch({ hotkey: parsed.value });
                      setManualHotkey(null);
                    }}
                  >
                    保存
                  </Button>
                  <Button tone="ghost" className="shrink-0" onClick={() => setManualHotkey(null)}>
                    取消
                  </Button>
                </div>
                {manualError !== null && <p className="mt-1 t-2xs text-[var(--warn-fg)]">{manualError}</p>}
              </div>
            )}
            {hotkeyConflict && (
              /* 2026-10-19：把"设不进去"讲清楚——**设置已经存下来了**（字段里看得到），
                 是系统不让我们注册它。中文输入法的中英切换默认就是 Ctrl+空格，被它占用时
                 任何程序都抢不到这个键，只能换键位或去输入法设置里改切换键。 */
              <p className="mt-1 flex items-start gap-1 t-2xs text-[var(--warn-fg)]">
                <TriangleAlert size={12} strokeWidth={1.75} aria-hidden className="mt-[2px] shrink-0" />
                <span>
                  已保存这个键位，但系统没让我们注册它（多半被输入法占用——中文输入法的中英切换默认就是
                  Ctrl+空格）。可以换成 Ctrl+Alt+Space，或在输入法设置里改掉切换键；窗口内仍可按这个键唤起快捷面板。
                </span>
              </p>
            )}

            <AppHotkeysSection overrides={settings.appHotkeys} globalHotkey={settings.hotkey} onPatch={onPatch} />
          </>
        )}

        {section === 'advanced' && (
          <>
            <SectionHead>管理员模式</SectionHead>
            <Row
              title="这台电脑作为管理员机"
              detail={
                roleAdmin
                  ? '已开启：本机对外提供团队同步服务'
                  : '开启后可发布团队入口，其他电脑从这里同步'
              }
              control={
                <Switch
                  ariaLabel="管理员模式"
                  checked={roleAdmin}
                  onChange={onToggleAdmin}
                />
              }
            />
            <Row
              title="管理员模式口令"
              detail={
                !roleAdmin
                  ? '开启管理员模式后可设置'
                  : adminStatus?.enrolled
                    ? '已设置。修改前需要先验证当前口令'
                    : '尚未设置。设置后本机即可解锁团队页编辑'
              }
              control={
                <Button
                  size="sm"
                  tone="secondary"
                  icon={KeyRound}
                  softDisabled={!roleAdmin}
                  onClick={onSetOrChangePassphrase}
                >
                  {adminStatus?.enrolled ? '修改口令' : '设置口令'}
                </Button>
              }
            />
            <p className="mt-1 t-xs text-[var(--muted)]">
              口令只保存在本机（单向加密），忘记后删除 credential.json 可重设
            </p>

            <Divider />
            <p className="t-xs w-emph mb-2 text-[var(--muted)]">更新分发</p>
            <Row
              title="更新分发目录"
              detail="把构建产出的 latest.yml 与安装包放进此目录，全团队的客户端会自动检查并更新。"
              control={
                <Button
                  size="sm"
                  tone="secondary"
                  icon={FolderOpen}
                  className="shrink-0 whitespace-nowrap"
                  onClick={onOpenUpdatesFolder}
                >
                  打开文件夹
                </Button>
              }
            />
          </>
        )}

        {section === 'about' && (
          <>
            <div className="flex items-center gap-3 pt-1">
              <BrandMark variant="solid" size={18} />
              <div className="min-w-0">
                <p className="t-md w-emph m-0 text-[var(--fg)]">TeamLaunch</p>
                <p className="t-xs m-0 text-[var(--muted)]">Windows 桌面端团队统一入口启动器</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-[var(--muted)]">应用版本</dt>
              <dd className="m-0 text-[var(--fg)]">v{APP_VERSION}</dd>
              <dt className="text-[var(--muted)]">团队数据版本</dt>
              <dd className="m-0 text-[var(--fg)]">
                {teamRevision != null ? `v${teamRevision}${announcedAt ? ' · ' + formatRevDate(announcedAt) : ''}` : '未同步'}
              </dd>
            </dl>
            <div className="mt-3 flex items-center gap-2">
              <span className="t-xs min-w-0 flex-1 text-[var(--fg-2)]">{updateStatusLine(updateStatus)}</span>
              <Button size="sm" tone="secondary" icon={RefreshCw} loading={updateChecking} onClick={onCheckUpdate}>
                检查更新
              </Button>
            </div>
            {/* O-07（2026-10-17）：自动检查是本项目唯一常态化的第三方外网出口（SECURITY.md 第 5 条），
                给一个开关：关掉 = 不排定时检查、零请求；「检查更新」按钮不受影响。 */}
            <Row
              title="自动检查更新"
              detail="启动后自动检查一次、之后每 6 小时一次；关掉后不会再访问更新源，随时可点上面的「检查更新」"
              control={
                <Switch
                  ariaLabel="自动检查更新"
                  checked={settings.autoCheckUpdates}
                  onChange={(next) => onPatch({ autoCheckUpdates: next })}
                />
              }
            />

            {/* 批 5（2026-10-17）：仓库 / 技术栈 / 更新日志 / 免责声明 */}
            <Divider />
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-[var(--muted)]">仓库</dt>
              <dd className="m-0 flex items-center gap-2">
                <span className="t-xs t-mono min-w-0 flex-1 truncate-1 text-[var(--fg)]">github.com/JiuZhang-9/teamlaunch</span>
                <Button
                  size="sm"
                  tone="ghost"
                  onClick={() => void api.entries.openExternal('https://github.com/JiuZhang-9/teamlaunch')}
                >
                  打开
                </Button>
                <Button
                  size="sm"
                  tone="ghost"
                  icon={Copy}
                  onClick={() => void api.clipboard.write('https://github.com/JiuZhang-9/teamlaunch')}
                >
                  复制
                </Button>
              </dd>
              <dt className="text-[var(--muted)]">更新日志</dt>
              <dd className="m-0 flex items-center gap-2">
                <span className="t-xs min-w-0 flex-1 text-[var(--fg-2)]">随安装包附带，离线也能看</span>
                <Button size="sm" tone="secondary" onClick={onOpenChangelog}>
                  查看更新日志
                </Button>
              </dd>
            </dl>
            <p className="t-2xs mt-3 mb-0 text-[var(--muted)]">
              技术栈：Electron · React · TypeScript · Vite · Tailwind CSS · Fastify
            </p>
            <p className="t-2xs mt-2 mb-0 text-[var(--muted)]">
              免责声明：本软件按「现状」提供（MIT 许可证），不附带任何明示或暗示的担保；安装包未做代码签名，
              请只从官方 Releases 页下载。团队入口内容由管理员发布，使用时请遵守所在组织的规定。
            </p>
            <p className="t-xs mt-4 mb-0 text-[var(--muted)]">
              把团队与个人常用入口集中在一处：点击即启动，管理员统一维护团队入口，本机入口只存在你自己的电脑上。
            </p>
            <Divider />
            <div className="flex items-center gap-2">
              <Monitor size={16} strokeWidth={2} aria-hidden className="text-[var(--meta)]" />
              <span className="t-xs t-mono flex-1 truncate-1 text-[var(--fg-2)]">本机设备标识 {deviceId}</span>
              <Button size="sm" tone="ghost" icon={Copy} onClick={onCopyDeviceId}>
                复制
              </Button>
            </div>
          </>
        )}
          </div>
        </ScrollArea>
      </div>
    </Dialog>
  );
}
