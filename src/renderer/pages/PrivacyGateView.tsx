/**
 * V-09 隐私说明门的视图层：把选择写进 settings.json。
 *
 * 未确认前**不发送任何上报、也不在磁盘上预缓冲**（AC-18）；
 * 选「不允许」同样写入 consentAt —— 未确认与明确拒绝是两种不同的状态，
 * 但两者都必须零记录。
 */
import { PrivacyGate } from '../components/organisms/PrivacyGate.tsx';
import { useSettings } from '../store/settingsStore.tsx';

export interface PrivacyGateViewProps {
  /** 从设置进入：展示当前值并提供「保持 / 改为」 */
  fromSettings: boolean;
  /** 首次启动的门不需要回调——选完就直接落进 settings 并进入主窗口 */
  onDone?(): void;
}

export function PrivacyGateView({ fromSettings, onDone }: PrivacyGateViewProps) {
  const { settings, patch } = useSettings();

  const decide = (allow: boolean) => {
    void patch({
      telemetryEnabled: allow,
      telemetryNoticeAckedAt: new Date().toISOString(),
    }).then(() => onDone?.());
  };

  return (
    <PrivacyGate
      viewingFromSettings={fromSettings}
      currentlyAllowed={settings.telemetryEnabled}
      onAllow={() => decide(true)}
      onDeny={() => decide(false)}
    />
  );
}
