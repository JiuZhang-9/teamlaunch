/**
 * V-07 设置面板的视图层。
 * 遥测开关在第一项、一级可见（PRD §15.3）；关闭立即生效，不弹二次确认（AC-18）。
 *
 * 管理员区此前的实现是"撒谎的"：口令输入框写死 teamlaunch 的掩码、设备标识是编造值、
 * 真正的设置口令流程藏在只有隐藏热键能打开的对话框里。现在：
 *  - status / deviceId 全部真实查询（api.admin.status / api.admin.deviceId）；
 *  - 未设口令 → 设置口令；已设 → 验证旧口令后修改；
 *  - 关闭管理员模式先确认——那意味着本机同步服务停止，其他电脑将退到缓存。
 */
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsPanel } from '../components/organisms/SettingsPanel.tsx';
import { Dialog } from '../components/organisms/Dialog.tsx';
import { ConfirmDialog } from '../components/organisms/SimpleDialog.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Input } from '../components/atoms/Input.tsx';
import { api } from '../bridge/index.ts';
import { AUTH } from '../../shared/constants.ts';
import { useSettings } from '../store/settingsStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import type { AdminStatus } from '../bridge/types.ts';

export interface SettingsPanelViewProps {
  onClose(): void;
  /** 外壳从主进程推送得出的真实热键注册状态。 */
  hotkeyConflict?: boolean;
}

type PassphraseMode = 'set' | 'change';

interface PassphraseDialogProps {
  mode: PassphraseMode;
  onDone(ok: boolean): void;
  onCancel(): void;
}

function PassphraseDialog({ mode, onDone, onCancel }: PassphraseDialogProps) {
  const [oldPass, setOldPass] = useState('');
  const [nextPass, setNextPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isChange = mode === 'change';

  const submit = async () => {
    if (busy) return;
    if (nextPass !== confirmPass) {
      setInvalid(true);
      setMessage('两次输入的新口令不一致，请重新输入');
      return;
    }
    setBusy(true);
    setMessage(null);
    setInvalid(false);
    try {
      if (isChange) {
        const verified = await api.admin.unlock(oldPass);
        if (!verified.ok) {
          setInvalid(true);
          setMessage('当前口令不正确，请重新输入');
          return;
        }
      }
      const r = await api.admin.enroll(nextPass);
      if (!r.ok) {
        setInvalid(true);
        setMessage(r.reason ?? '口令不符合要求，请换一个再试');
        return;
      }
      onDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={isChange ? '修改管理员口令' : '设置管理员口令'}
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
            icon={isChange ? KeyRound : ShieldCheck}
            loading={busy}
            softDisabled={nextPass.length === 0 || confirmPass.length === 0 || (isChange && oldPass.length === 0)}
            onClick={() => void submit()}
          >
            {isChange ? '确认修改' : '设置口令'}
          </Button>
        </>
      }
    >
      {isChange && (
        <>
          <p className="t-xs mb-1 text-[var(--muted)]">当前口令</p>
          <Input
            type="password"
            value={oldPass}
            invalid={invalid}
            aria-label="当前管理员口令"
            placeholder="先验证当前口令"
            leading={<KeyRound size={16} strokeWidth={2} aria-hidden className="text-[var(--meta)]" />}
            onChange={(e) => {
              setOldPass(e.target.value);
              setInvalid(false);
              setMessage(null);
            }}
          />
        </>
      )}
      <p className="t-xs mb-1 mt-2 text-[var(--muted)]">新口令</p>
      <Input
        ref={inputRef}
        type="password"
        value={nextPass}
        invalid={invalid}
        aria-label="新管理员口令"
        placeholder="请记住它——忘记后无法找回"
        leading={<KeyRound size={16} strokeWidth={2} aria-hidden className="text-[var(--meta)]" />}
        onChange={(e) => {
          setNextPass(e.target.value);
          setInvalid(false);
          setMessage(null);
        }}
      />
      {/* 设置口令的人就是管理员本人：要求明示在界面上。
          （PRD §14.1 禁止的是"验证失败时"回传规则——那是给猜口令的人看的场景，与此处不同。） */}
      <p className="mt-1 t-2xs text-[var(--meta)]">至少 {AUTH.minPasswordLength} 位</p>
      <p className="t-xs mb-1 mt-2 text-[var(--muted)]">再输入一次</p>
      <Input
        type="password"
        value={confirmPass}
        invalid={invalid}
        aria-label="确认新口令"
        placeholder="再输入一次新口令"
        leading={<KeyRound size={16} strokeWidth={2} aria-hidden className="text-[var(--meta)]" />}
        onChange={(e) => {
          setConfirmPass(e.target.value);
          setInvalid(false);
          setMessage(null);
        }}
      />
      {message && <p className="mt-2 t-xs text-[var(--danger-fg)]">{message}</p>}
    </Dialog>
  );
}

export function SettingsPanelView({ onClose, hotkeyConflict = false }: SettingsPanelViewProps) {
  const { settings, patch } = useSettings();
  const { snapshot } = useSync();
  const { push } = useToasts();
  const { openDialog, settingsSection } = useWorkbench();
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [passphraseMode, setPassphraseMode] = useState<PassphraseMode | null>(null);
  const [confirmAdminOff, setConfirmAdminOff] = useState(false);

  const reloadStatus = useCallback(async () => {
    setAdminStatus(await api.admin.status());
  }, []);

  useEffect(() => {
    void reloadStatus();
    void api.admin.deviceId().then(setDeviceId).catch(() => undefined);
  }, [reloadStatus]);

  // 角色切换是异步重装（起/停内嵌服务、起同步客户端），期间 adminStatus 会经历一段
  // 旧端口作答的空窗。重装完成必然推一次新的同步快照——以它为信号重查状态，
  // 否则面板会冻结在空窗期的矛盾答案上（显示"已开启+未设口令"）。
  useEffect(() => {
    void reloadStatus();
  }, [reloadStatus, snapshot.state]);

  const toggleAdmin = async (next: boolean) => {
    if (!next) {
      setConfirmAdminOff(true);
      return;
    }
    await patch({ role: 'admin' });
    await reloadStatus();
    push({ title: '已开启管理员模式，接下来请设置团队口令', tone: 'success' });
  };

  const isAdminRole = settings.role === 'admin';

  return (
    <>
      <SettingsPanel
        settings={settings}
        zoom={settings.uiZoom}
        onZoom={(z) => void patch({ uiZoom: z })}
        teamRevision={snapshot.revision}
        announcedAt={snapshot.config?.publishedAt ?? null}
        deviceId={deviceId}
        adminStatus={adminStatus}
        roleAdmin={isAdminRole}
        onToggleAdmin={(next) => void toggleAdmin(next)}
        onSetOrChangePassphrase={() => setPassphraseMode(adminStatus?.enrolled ? 'change' : 'set')}
        onOpenUpdatesFolder={() => void api.updater.openUpdatesFolder()}
        hotkeyConflict={hotkeyConflict}
        initialSection={settingsSection}
        onPatch={(p) => {
          void patch(p).then(() => {
            if (p.telemetryEnabled === false) {
              push({ title: '已关闭使用数据统计，本机待发送数据已清空', tone: 'info' });
            }
          });
        }}
        onClose={onClose}
        onViewPrivacy={() => {
          onClose();
          openDialog('privacy');
        }}
        onCopyDeviceId={() => {
          void api.clipboard.write(deviceId).then((ok) => {
            push({ title: ok ? '本机设备标识已复制' : '没能写入剪贴板，请手动选择文本复制', tone: ok ? 'success' : 'danger' });
          });
        }}
      />

      {passphraseMode && (
        <PassphraseDialog
          mode={passphraseMode}
          onCancel={() => setPassphraseMode(null)}
          onDone={(ok) => {
            setPassphraseMode(null);
            if (ok) {
              void reloadStatus();
              push({ title: '管理员口令已保存', tone: 'success' });
            }
          }}
        />
      )}

      {confirmAdminOff && (
        <ConfirmDialog
          title="关闭管理员模式？"
          detail="本机的团队同步服务会停止，其他电脑将退回使用各自的缓存数据。你可以随时再开启。"
          confirmLabel="关闭管理员模式"
          destructive
          onCancel={() => setConfirmAdminOff(false)}
          onConfirm={() => {
            setConfirmAdminOff(false);
            void patch({ role: 'member' }).then(() => {
              void reloadStatus();
              push({ title: '已关闭管理员模式，本机同步服务已停止', tone: 'info' });
            });
          }}
        />
      )}
    </>
  );
}
