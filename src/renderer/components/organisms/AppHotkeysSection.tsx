/**
 * AppHotkeysSection —— 设置里的「应用内快捷键」区块（2026-10-02）。
 *
 * 每行 = 动作 + 当前加速器 + 重新录制。录制规则与全局热键一致：
 * Esc 取消、Backspace/Delete 解绑、修饰键单独按下不算、冲突拒绝（toast 说明与谁冲突）。
 * 只存覆盖值：用户没录过的动作跟随内置默认（shared/app-hotkeys.ts）。
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import {
  APP_HOTKEY_LABELS,
  DEFAULT_APP_HOTKEYS,
  acceleratorOf,
  type AppHotkeyAction,
} from '../../../shared/app-hotkeys.ts';
import { useToasts } from '../../store/toastStore.tsx';

export interface AppHotkeysSectionProps {
  /** 用户覆盖表（settings.appHotkeys，可能为空对象）。 */
  overrides: Record<string, string>;
  /** 全局快捷搜索热键（OS 级）：应用内键位与它相同也视为冲突（全局热键会先吞掉按键）。 */
  globalHotkey: string;
  onPatch(patch: { appHotkeys: Record<string, string> }): void;
}

export function AppHotkeysSection({ overrides, globalHotkey, onPatch }: AppHotkeysSectionProps) {
  const { push } = useToasts();
  const [recording, setRecording] = useState<AppHotkeyAction | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** 未绑定仅指用户显式解绑（覆盖值为空串）；未出现在覆盖表里 = 跟随内置默认。 */
  const isUnbound = (id: AppHotkeyAction): boolean => {
    const raw = overrides[id];
    return raw !== undefined && raw.trim().length === 0;
  };
  const effective = (id: AppHotkeyAction): string => {
    const raw = overrides[id];
    if (raw !== undefined && raw.trim().length === 0) return '';
    return raw !== undefined && raw.trim().length > 0 ? raw : DEFAULT_APP_HOTKEYS[id];
  };

  useEffect(() => {
    if (recording) inputRef.current?.focus();
  }, [recording]);

  const startRecording = (id: AppHotkeyAction) => {
    setRecording(id);
  };

  const finishRecording = (id: AppHotkeyAction, accel: string | null) => {
    setRecording(null);
    if (accel === null) return; // Esc 取消
    // 冲突检查：同应用内其他动作 + 全局快捷搜索热键
    const clash = (Object.keys(DEFAULT_APP_HOTKEYS) as AppHotkeyAction[])
      .filter((k) => k !== id)
      .find((k) => effective(k) === accel);
    if (clash) {
      push({ title: `与「${APP_HOTKEY_LABELS[clash]}」的快捷键冲突，请换一个键`, tone: 'warn' });
      return;
    }
    if (accel === globalHotkey) {
      push({ title: '与全局快捷搜索热键冲突，请换一个键', tone: 'warn' });
      return;
    }
    onPatch({ appHotkeys: { ...overrides, [id]: accel } });
  };

  return (
    <>
      <div className="my-2 h-px w-full bg-[var(--border-subtle)]" />
      <p className="t-xs w-emph mb-2 text-[var(--muted)]">应用内快捷键</p>
      <p className="t-2xs mb-2 text-[var(--muted)]">
        点击「重新录制」后按下新组合键；Esc 取消，Backspace 解绑。改完立即生效。
      </p>
      <div className="flex flex-col">
        {(Object.keys(DEFAULT_APP_HOTKEYS) as AppHotkeyAction[]).map((id) => {
          const isRecording = recording === id;
          return (
            <div key={id} className="flex min-h-[var(--row-h)] items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="t-base text-[var(--fg)]">{APP_HOTKEY_LABELS[id]}</p>
              </div>
              {isRecording ? (
                /* Input 原子恒为 w-full：固定宽由包裹层给足并钉死，否则输入框会吃光整行、
                   左侧动作名被挤成一字一行（实测 2026-10-03）。 */
                <div className="w-[190px] shrink-0">
                  <Input
                    ref={inputRef}
                    readOnly
                    mono
                    value="按下新的组合键…"
                    aria-label={`录制 ${APP_HOTKEY_LABELS[id]} 的新快捷键`}
                    onKeyDown={(e) => {
                      e.preventDefault();
                      if (e.key === 'Escape') {
                        setRecording(null);
                        return;
                      }
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        finishRecording(id, '');
                        return;
                      }
                      const accel = acceleratorOf(e);
                      if (accel) finishRecording(id, accel);
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="w-[190px] shrink-0">
                    <Input
                      readOnly
                      mono
                      value={isUnbound(id) ? '未绑定' : effective(id)}
                      aria-label={`${APP_HOTKEY_LABELS[id]} 的快捷键`}
                      onFocus={(e) => e.currentTarget.blur()}
                    />
                  </div>
                  <Button
                    tone="secondary"
                    icon={Keyboard}
                    className="shrink-0 whitespace-nowrap"
                    onClick={() => startRecording(id)}
                  >
                    重新录制
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
