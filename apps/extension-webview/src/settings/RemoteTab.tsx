import { useEffect, useState } from "react";
import {
  CircleNotch,
  DeviceMobile,
  FolderSimple,
  GlobeSimple,
  QrCode,
  Trash,
} from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { post } from "../vscodeApi";
import type { RemoteStatus, WebviewState } from "../contracts";
import { useT } from "./i18n";
import { SettingsCard, Toggle, useHostMessage } from "./primitives";

/** Display form of a pairing code: ABCD-EFGH (dash is chrome, not data). */
function formatPairCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** QR payload prefix — must match PAIR_QR_PREFIX in the relay protocol. */
const QR_PREFIX = "luno-pair:";

/**
 * Remote — pair Telegram WebApp phones with this extension instance. The tab
 * is a thin view over `{type:"remote"}` status pushes from the RemoteBridge:
 * enable toggle, live pairing code + QR, and the paired-device list.
 */
export function RemoteTab({ state }: { state: WebviewState }) {
  const t = useT();
  const [status, setStatus] = useState<RemoteStatus | undefined>();
  // Local countdown re-render tick while a pairing code is showing.
  const [, setTick] = useState(0);

  useHostMessage((msg) => {
    if (msg.type === "remote") setStatus(msg.status);
  });

  // Ask for the current status once on mount (the bridge answers via
  // broadcast, which the useHostMessage above picks up).
  useEffect(() => {
    post({ type: "remoteStatus" });
  }, []);

  const pairing = status?.pairing;
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [pairing]);

  const enabled = status?.enabled ?? state.settings.remote?.enabled ?? false;
  const connected = status?.connected ?? false;
  const devices = status?.devices ?? [];
  const secondsLeft = pairing
    ? Math.max(0, Math.floor((pairing.expiresAt - Date.now()) / 1000))
    : 0;

  return (
    <div className="settings-pane-section animate-fade">
      <div className="pane-header">
        <h2>{t.remoteTab.title}</h2>
        <p>{t.remoteTab.desc}</p>
      </div>

      <SettingsCard
        icon={<DeviceMobile size={15} />}
        title={t.remoteTab.status}
        badge={
          <span className={`s2l-status ${connected ? "ok" : ""}`}>
            <span className="s2l-status-dot" />
            {connected ? t.remoteTab.connected : t.remoteTab.disconnected}
          </span>
        }
      >
        <div className="settings-toggle-list">
          <Toggle
            label={t.remoteTab.enable}
            hint={t.remoteTab.enableHint}
            checked={enabled}
            onChange={(v) => post({ type: "remoteSetEnabled", enabled: v })}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<QrCode size={15} />}
        title={t.remoteTab.pairTitle}
        desc={t.remoteTab.pairDesc}
      >
        {!enabled ? (
          <p className="group-card-desc">{t.remoteTab.disabledNote}</p>
        ) : pairing && secondsLeft > 0 ? (
          <div className="s2l-pair">
            <div className="s2l-qr">
              <QRCodeSVG
                value={`${QR_PREFIX}${pairing.code}`}
                size={132}
                marginSize={2}
              />
            </div>
            <div className="s2l-pair-side">
              <span className="s2l-code-label">{t.remoteTab.scanHint}</span>
              <span className="s2l-code">{formatPairCode(pairing.code)}</span>
              <span className="s2l-waiting">
                <CircleNotch size={13} className="s2l-spin" weight="bold" />
                {t.remoteTab.expiresIn}{" "}
                {Math.floor(secondsLeft / 60)}:
                {String(secondsLeft % 60).padStart(2, "0")}
              </span>
              <button
                className="s2l-btn s2l-btn-ghost"
                onClick={() => post({ type: "remoteNewPairCode" })}
              >
                {t.remoteTab.pairAgain}
              </button>
            </div>
          </div>
        ) : (
          <div className="s2-row">
            <button
              className="s2l-btn s2l-btn-primary"
              disabled={!connected}
              onClick={() => post({ type: "remoteNewPairCode" })}
            >
              {t.remoteTab.pairBtn}
            </button>
            {!connected && (
              <span className="toggle-hint-text">
                {t.remoteTab.notConnectedHint}
              </span>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        icon={<DeviceMobile size={15} />}
        title={t.remoteTab.devices}
      >
        {devices.length === 0 ? (
          <p className="group-card-desc">{t.remoteTab.noDevices}</p>
        ) : (
          <div className="settings-toggle-list">
            {devices.map((d) => (
              <div className="settings-toggle-row" key={d.id}>
                <div className="settings-toggle-info">
                  <span className="toggle-label-text">
                    {d.label}
                    {"  "}
                    <span className="s2-card-badge">
                      {d.scope === "project" ? (
                        <>
                          <FolderSimple size={11} weight="bold" />{" "}
                          {t.remoteTab.scopeProject}
                          {d.workspaceName ? ` · ${d.workspaceName}` : ""}
                        </>
                      ) : (
                        <>
                          <GlobeSimple size={11} weight="bold" />{" "}
                          {t.remoteTab.scopeSystem}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="toggle-hint-text">
                    {t.remoteTab.tgIdLabel} {d.tgId} · {t.remoteTab.lastSeen}{" "}
                    {d.lastSeenAt
                      ? new Date(d.lastSeenAt).toLocaleString()
                      : t.remoteTab.never}
                  </span>
                </div>
                <button
                  className="s2l-icon-btn"
                  title={t.remoteTab.revoke}
                  aria-label={t.remoteTab.revoke}
                  onClick={() => post({ type: "remoteRevoke", deviceId: d.id })}
                >
                  <Trash size={15} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
