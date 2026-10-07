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
  MonitorCog,
  Moon,
  SlidersHorizontal,
  Sun,
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
import { Dialog } from './Dialog.tsx';
import { AppHotkeysSection } from './AppHotkeysSection.tsx';
import type { SettingsSection } from '../../store/workbenchStore.tsx';
import type { Settings } from '../../../shared/schema/local.ts';
import type { AdminStatus } from '../../bridge/types.ts';
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

export interface SettingsPanelProps {
  settings: Settings;
  onPatch(p: Partial<Settings>): void;
  onClose(): void;
  onViewPrivacy(): void;
  /** 界面缩放百分比（80–150）。浏览器式 zoom，窗口不变内容等比缩放。 */
  zoom: number;
  onZoom(z: number): void;
  onCopyDeviceId(): void;
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

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange(v: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={[
              'flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 t-sm',
              'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
              selected ? 'w-emph' : 'hover:bg-[var(--bg-surface-hover)]',
            ].join(' ')}
            style={{
              background: selected ? 'var(--tab-bg-selected)' : 'transparent',
              color: selected ? 'var(--fg)' : 'var(--fg-2)',
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
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
        <p className="t-base text-[var(--fg)]">{title}</p>
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
  settings, onPatch, onClose, onViewPrivacy, zoom, onZoom, onCopyDeviceId,
  adminStatus, roleAdmin, onToggleAdmin, onSetOrChangePassphrase, onOpenUpdatesFolder, announcedAt,
  hotkeyConflict = false, teamRevision, deviceId, initialSection,
}: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [recording, setRecording] = useState(false);
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
            <Segmented
              label="外观"
              value={settings.theme}
              onChange={(v) => onPatch({ theme: v })}
              options={[
                { value: 'light', label: '浅色', icon: <Sun size={16} strokeWidth={2} aria-hidden /> },
                { value: 'dark', label: '深色', icon: <Moon size={16} strokeWidth={2} aria-hidden /> },
                { value: 'system', label: '跟随系统', icon: <MonitorCog size={16} strokeWidth={2} aria-hidden /> },
              ]}
            />

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
                  const parts: string[] = [];
                  if (e.ctrlKey) parts.push('Ctrl');
                  if (e.altKey) parts.push('Alt');
                  if (e.shiftKey) parts.push('Shift');
                  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
                  onPatch({ hotkey: parts.join('+') });
                  setRecording(false);
                }}
                />
              </div>
              <Button tone="secondary" icon={Keyboard} className="shrink-0 whitespace-nowrap" onClick={() => setRecording(true)}>
                重新录制
              </Button>
            </div>
            {hotkeyConflict && (
              <p className="mt-1 flex items-center gap-1 t-2xs text-[var(--warn-fg)]">
                <TriangleAlert size={12} strokeWidth={1.75} aria-hidden />
                此热键可能已被输入法占用，建议改为 Ctrl+Alt+Space
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
              <dd className="m-0 text-[var(--fg)]">v{__APP_VERSION__}</dd>
              <dt className="text-[var(--muted)]">团队数据版本</dt>
              <dd className="m-0 text-[var(--fg)]">
                {teamRevision != null ? `v${teamRevision}${announcedAt ? ' · ' + formatRevDate(announcedAt) : ''}` : '未同步'}
              </dd>
            </dl>
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
