/**
 * 管理员口令：三态 —— 引导开启角色 / 设置 / 验证。
 *
 * 第三态（引导）是补上的关键一环。此前只有设置与验证两态，
 * 而"这台机器**能不能**设置口令"没有被单独表达：一台全新安装（role=member）的机器
 * 会直接走到"请输入口令"——口令不存在、界面也没有任何设置入口，用户被彻底卡死。
 *
 * 共同纪律（V-05 S1/S2）：
 *  - 验证失败**不得清空已输入内容**，只把边框换成错误色并给出行内说明；
 *  - 口令规则不回传界面：长度不足也只说"不符合要求"，不写"至少 N 位"（PRD §14.1）。
 */
import { KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { Dialog } from './Dialog.tsx';
import type { AdminStatus } from '../../bridge/types.ts';
import { AUTH } from '../../../shared/constants.ts';

export interface AdminUnlockDialogProps {
  /** null = 状态还没查到（渲染骨架，不要闪一下错误态）。 */
  status: AdminStatus | null;
  onCancel(): void;
  /** 把本机切成管理员角色；成功后调用方重新查一次 status。 */
  onEnableAdmin(): Promise<boolean>;
  /** 设置成功即代表本机已解锁，调用方不要再让用户输第二遍。 */
  onEnroll(passphrase: string): Promise<{ ok: boolean; reason?: string }>;
  onUnlock(passphrase: string): Promise<{ ok: boolean }>;
}

type Mode = 'loading' | 'needRole' | 'enroll' | 'unlock';

export function AdminUnlockDialog({
  status, onCancel, onEnableAdmin, onEnroll, onUnlock,
}: AdminUnlockDialogProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const mode: Mode = !status ? 'loading' : !status.canEnroll ? 'needRole' : status.enrolled ? 'unlock' : 'enroll';

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setInvalid(false);
    try {
      if (mode === 'needRole') {
        const ok = await onEnableAdmin();
        if (!ok) setMessage('切换管理员角色失败，请重试或重启应用后再试');
        return;
      }
      if (mode === 'enroll') {
        if (passphrase !== confirm) {
          setInvalid(true);
          setMessage('两次输入的口令不一致，请重新输入');
          return;
        }
        const r = await onEnroll(passphrase);
        if (!r.ok) {
          setInvalid(true);
          setMessage(r.reason ?? '口令不符合要求，请换一个再试');
        }
        return;
      }
      const ok = await onUnlock(passphrase);
      if (!ok.ok) {
        setInvalid(true);
        setMessage('口令不正确，请重新输入');
      }
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'loading') {
    return (
      <Dialog title="启用管理员模式" width="normal" onClose={onCancel}>
        <p className="t-sm text-[var(--fg-2)]">正在检查本机口令状态…</p>
      </Dialog>
    );
  }

  if (mode === 'needRole') {
    return (
      <Dialog
        title="这台电脑还不是管理员机"
        width="normal"
        onClose={onCancel}
        footer={
          <>
            <Button tone="ghost" size="lg" onClick={onCancel}>
              取消
            </Button>
            <Button tone="primary" size="lg" icon={UserCog} loading={busy} onClick={() => void submit()}>
              开启管理员角色
            </Button>
          </>
        }
      >
        <p className="t-sm mb-2 text-[var(--fg-2)]">
          只有管理员电脑才能发布团队入口。开启后，这台电脑会对外提供同步服务，
          并且可以设置一个团队共用的管理员口令。
        </p>
        <p className="t-sm text-[var(--fg-2)]">
          如果你只是要使用团队入口、不负责维护，就不用开启——保持现在的状态即可。
        </p>
        {message && <p className="mt-2 t-xs text-[var(--danger-fg)]">{message}</p>}
      </Dialog>
    );
  }

  const isEnroll = mode === 'enroll';

  return (
    <Dialog
      title={isEnroll ? '设置管理员口令' : '启用管理员模式'}
      width="normal"
      onClose={onCancel}
      initialFocus={inputRef}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onCancel}>
            取消
          </Button>
          <Button
            tone="primary"
            size="lg"
            icon={isEnroll ? ShieldCheck : undefined}
            loading={busy}
            disabled={isEnroll && passphrase.length === 0}
            onClick={() => void submit()}
          >
            {isEnroll ? '设置并启用' : '启用'}
          </Button>
        </>
      }
    >
      <p className="t-sm mb-2 text-[var(--fg-2)]">
        {isEnroll
          ? '这台电脑还没有管理员口令。设置后即可获得团队页编辑权限，请记住它——忘记后无法找回。'
          : '口令由管理员设置，输入后本机会获得团队页编辑权限'}
      </p>
      {isEnroll && (
        <p className="mb-2 t-xs text-[var(--muted)]">口令至少 {AUTH.minPasswordLength} 位（设置口令的人是管理员本人，要求明示）</p>
      )}

      <Input
        ref={inputRef}
        type="password"
        value={passphrase}
        invalid={invalid}
        aria-label={isEnroll ? '设置管理员口令' : '管理员口令'}
        placeholder={isEnroll ? '请输入新口令' : '请输入口令'}
        leading={<KeyRound size={16} strokeWidth={2} aria-hidden className="text-[var(--meta)]" />}
        onChange={(e) => {
          setPassphrase(e.target.value);
          if (invalid) {
            setInvalid(false);
            setMessage(null);
          }
        }}
      />

      {isEnroll && (
        <div className="mt-2">
          <Input
            type="password"
            value={confirm}
            invalid={invalid}
            aria-label="确认管理员口令"
            placeholder="请再输入一次"
            leading={<KeyRound size={16} strokeWidth={2} aria-hidden className="text-[var(--meta)]" />}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (invalid) {
                setInvalid(false);
                setMessage(null);
              }
            }}
          />
        </div>
      )}

      {message && <p className="mt-1 t-xs text-[var(--danger-fg)]">{message}</p>}
    </Dialog>
  );
}
