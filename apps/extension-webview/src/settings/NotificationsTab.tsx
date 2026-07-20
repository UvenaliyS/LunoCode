import { BellRinging, SpeakerHigh } from "@phosphor-icons/react";
import type { NotificationSettings, WebviewState } from "../contracts";
import { DEFAULT_NOTIFICATIONS } from "../contracts";
import { useT } from "./i18n";
import { SettingsCard, Toggle, setSetting } from "./primitives";

export function NotificationsTab({ state }: { state: WebviewState }) {
  const t = useT();
  const notif = state.settings.notifications ?? DEFAULT_NOTIFICATIONS;

  function setNotif(patch: Partial<NotificationSettings>) {
    setSetting("notifications", { ...notif, ...patch });
  }

  return (
    <div className="settings-pane-section animate-fade s2-notif">
      <div className="pane-header">
        <h2>{t.notifications.title}</h2>
        <p>{t.notifications.desc}</p>
      </div>

      <SettingsCard icon={<BellRinging size={15} />} title={t.notifications.triggers}>
        <div className="settings-toggle-list">
          <Toggle
            label={t.notifications.master}
            hint={t.notifications.masterHint}
            checked={notif.enabled}
            onChange={(v) => setNotif({ enabled: v })}
          />
          <Toggle
            label={t.notifications.onComplete}
            hint={t.notifications.onCompleteHint}
            checked={notif.onComplete}
            disabled={!notif.enabled}
            onChange={(v) => setNotif({ onComplete: v })}
          />
          <Toggle
            label={t.notifications.onApproval}
            hint={t.notifications.onApprovalHint}
            checked={notif.onApproval}
            disabled={!notif.enabled}
            onChange={(v) => setNotif({ onApproval: v })}
          />
          <Toggle
            label={t.notifications.onError}
            hint={t.notifications.onErrorHint}
            checked={notif.onError}
            disabled={!notif.enabled}
            onChange={(v) => setNotif({ onError: v })}
          />
        </div>
      </SettingsCard>

      <SettingsCard icon={<SpeakerHigh size={15} />} title={t.notifications.delivery}>
        <div className="settings-toggle-list">
          <Toggle
            label={t.notifications.sound}
            hint={t.notifications.soundHint}
            checked={notif.sound}
            disabled={!notif.enabled}
            onChange={(v) => setNotif({ sound: v })}
          />
          <Toggle
            label={t.notifications.osBanner}
            hint={t.notifications.osBannerHint}
            checked={notif.osBanner}
            disabled={!notif.enabled}
            onChange={(v) => setNotif({ osBanner: v })}
          />
        </div>
      </SettingsCard>
    </div>
  );
}
