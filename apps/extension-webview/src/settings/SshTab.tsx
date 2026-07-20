import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  HardDrives,
  TerminalWindow,
  Key,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { post } from "../vscodeApi";
import type {
  SshAuthMethod,
  SshServerMeta,
  SshTestResult,
  WebviewState,
} from "../contracts";
import { useT } from "./i18n";
import { SettingsCard, Toggle, setSetting, useHostMessage } from "./primitives";

interface TestState {
  testing?: boolean;
  result?: SshTestResult;
}

export function SshTab({ state }: { state: WebviewState }) {
  const t = useT();
  const [servers, setServers] = useState<SshServerMeta[]>(state.sshServers ?? []);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [editing, setEditing] = useState<SshServerMeta | "new" | undefined>();

  useEffect(() => {
    if (state.sshServers) setServers(state.sshServers);
  }, [state.sshServers]);

  useHostMessage((msg) => {
    if (msg.type === "sshServers") {
      setServers(msg.servers);
    } else if (msg.type === "sshTestResult") {
      setTests((p) => ({ ...p, [msg.id]: { testing: false, result: msg.result } }));
    }
  });

  useEffect(() => {
    post({ type: "sshList" });
  }, []);

  function runTest(id: string) {
    setTests((p) => ({ ...p, [id]: { ...p[id], testing: true } }));
    post({ type: "sshTest", id });
  }

  return (
    <div className="settings-pane-section animate-fade s2-ssh">
      <div className="pane-header">
        <h2>{t.ssh.title}</h2>
        <p>{t.ssh.desc}</p>
      </div>

      <SettingsCard icon={<HardDrives size={15} />} title={t.ssh.enable}>
        <div className="settings-toggle-list">
          <Toggle
            label={t.ssh.enable}
            hint={t.ssh.enableHint}
            checked={state.settings.sshEnabled}
            onChange={(v) => setSetting("sshEnabled", v)}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={<Key size={15} />}
        title={t.ssh.servers}
        badge={
          !editing && (
            <button
              className="s2-icon-btn"
              title={t.ssh.addServer}
              onClick={() => setEditing("new")}
            >
              <Plus size={14} weight="bold" />
            </button>
          )
        }
        desc={t.ssh.serversDesc}
      >
        {servers.length === 0 && !editing && (
          <span className="field-hint-text">{t.ssh.noServers}</span>
        )}

        {servers.length > 0 && (
          <div className="s2-list">
            {servers.map((srv) => (
              <div className="s2-item" key={srv.id}>
                <span className="s2-item-ic">
                  <TerminalWindow size={16} />
                </span>
                <div className="s2-item-main">
                  <span className="s2-item-title">
                    <span>{srv.name}</span>
                    <span className="s2-chip">
                      {srv.auth === "privateKey" ? t.ssh.authKey : t.ssh.authPassword}
                    </span>
                  </span>
                  <span className="s2-item-sub">
                    {srv.username}@{srv.host}:{srv.port}
                  </span>
                  <TestSummary test={tests[srv.id]} />
                </div>
                <div className="s2-item-actions">
                  <button
                    className="settings-btn-outline"
                    disabled={!!tests[srv.id]?.testing}
                    onClick={() => runTest(srv.id)}
                  >
                    {tests[srv.id]?.testing ? t.common.testing : t.common.test}
                  </button>
                  <button
                    className="s2-icon-btn"
                    title={t.common.edit}
                    onClick={() => setEditing(srv)}
                  >
                    <PencilSimple size={14} />
                  </button>
                  <button
                    className="s2-icon-btn danger"
                    title={t.common.delete}
                    onClick={() => post({ type: "sshDelete", id: srv.id })}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <ServerForm
            server={editing === "new" ? undefined : editing}
            onDone={() => setEditing(undefined)}
          />
        )}
      </SettingsCard>
    </div>
  );
}

function TestSummary({ test }: { test?: TestState }) {
  const t = useT();
  if (test?.testing) return <span className="s2-item-sub">{t.common.testing}</span>;
  const r = test?.result;
  if (!r) return null;
  return r.ok ? (
    <span className="s2-item-sub">
      {t.common.ok}
      {r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""}
    </span>
  ) : (
    <span className="s2-item-sub">
      {t.common.failed}
      {r.error ? ` · ${r.error}` : ""}
    </span>
  );
}

/* ── Add / edit form (secret travels host-side only via sshUpsert) ───────── */

function ServerForm({
  server,
  onDone,
}: {
  server?: SshServerMeta;
  onDone: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(server?.name ?? "");
  const [host, setHost] = useState(server?.host ?? "");
  const [port, setPort] = useState(server ? String(server.port) : "22");
  const [username, setUsername] = useState(server?.username ?? "");
  const [auth, setAuth] = useState<SshAuthMethod>(server?.auth ?? "password");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const portNum = Number(port);
  const valid =
    name.trim().length > 0 &&
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    Number.isInteger(portNum) &&
    portNum > 0 &&
    portNum <= 65535 &&
    // New servers need a secret; edits may keep the stored one.
    (server !== undefined || secret.length > 0);

  function save() {
    if (!valid) return;
    post({
      type: "sshUpsert",
      server: {
        id: server?.id,
        name: name.trim(),
        host: host.trim(),
        port: portNum,
        username: username.trim(),
        auth,
        secret: secret || undefined,
        passphrase: auth === "privateKey" ? passphrase || undefined : undefined,
      },
    });
    onDone();
  }

  return (
    <div className="s2-form">
      <div className="s2-form-grid">
        <div className="settings-field">
          <label>{t.ssh.name}</label>
          <input
            className="s2-input"
            placeholder="prod-web"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label>{t.ssh.host}</label>
          <input
            className="s2-input"
            placeholder="203.0.113.7"
            value={host}
            spellCheck={false}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label>{t.ssh.port}</label>
          <input
            className="s2-input"
            inputMode="numeric"
            placeholder="22"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
        <div className="settings-field">
          <label>{t.ssh.username}</label>
          <input
            className="s2-input"
            placeholder="ubuntu"
            value={username}
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label>{t.ssh.auth}</label>
          <select
            className="settings-select"
            value={auth}
            onChange={(e) => setAuth(e.target.value as SshAuthMethod)}
          >
            <option value="password">{t.ssh.authPassword}</option>
            <option value="privateKey">{t.ssh.authKey}</option>
          </select>
        </div>
        {auth === "privateKey" ? (
          <div className="settings-field">
            <label>{t.ssh.secretKey}</label>
            <span className="field-hint-text">{t.ssh.keyFileHint}</span>
            <KeyFilePicker
              value={secret}
              hasStored={!!server && !secret}
              storedLabel={t.ssh.secretKeepHint}
              chooseLabel={t.ssh.keyChoose}
              replaceLabel={t.ssh.keyReplace}
              loadedLabel={t.ssh.keyLoaded}
              clearLabel={t.common.cancel}
              onLoad={setSecret}
            />
          </div>
        ) : (
          <div className="settings-field">
            <label>{t.ssh.secretPassword}</label>
            {server && <span className="field-hint-text">{t.ssh.secretKeepHint}</span>}
            <input
              className="s2-input"
              type="password"
              placeholder="••••••••"
              value={secret}
              spellCheck={false}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
        )}
        {auth === "privateKey" && (
          <div className="settings-field">
            <label>
              {t.ssh.passphrase}
              <span className="ssh-optional">{t.ssh.optional}</span>
            </label>
            <span className="field-hint-text">{t.ssh.passphraseHint}</span>
            <input
              className="s2-input"
              type="password"
              placeholder="••••••••"
              value={passphrase}
              spellCheck={false}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
        )}
      </div>
      <div className="s2-form-actions">
        <button className="settings-btn-primary" disabled={!valid} onClick={save}>
          {server ? t.common.save : t.ssh.addServer}
        </button>
        <button className="settings-btn-outline" onClick={onDone}>
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}

/**
 * Private-key picker: reads a key file (PEM / OpenSSH — id_rsa, id_ed25519,
 * .pem, .key, or extensionless) as text into the secret, so the user uploads a
 * file instead of pasting the whole key. The key text never leaves the webview
 * beyond the normal sshUpsert path (host-side secret storage).
 */
function KeyFilePicker({
  value,
  hasStored,
  storedLabel,
  chooseLabel,
  replaceLabel,
  loadedLabel,
  clearLabel,
  onLoad,
}: {
  value: string;
  hasStored: boolean;
  storedLabel: string;
  chooseLabel: string;
  replaceLabel: string;
  loadedLabel: string;
  clearLabel: string;
  onLoad: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | undefined>();

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onLoad(text.trim());
    setFileName(file.name);
    // Reset so re-picking the same file still fires onChange.
    if (inputRef.current) inputRef.current.value = "";
  }

  const loaded = value.length > 0;

  return (
    <div className="ssh-keyfile">
      <input
        ref={inputRef}
        type="file"
        className="ssh-keyfile-input"
        accept=".pem,.key,.ppk,.txt,application/x-pem-file,*/*"
        onChange={pick}
      />
      {loaded ? (
        <div className="ssh-keyfile-loaded">
          <CheckCircle size={14} weight="fill" className="ssh-keyfile-ok" />
          <span className="ssh-keyfile-name">{fileName ?? loadedLabel}</span>
          <button
            type="button"
            className="ssh-keyfile-clear"
            title={clearLabel}
            onClick={() => {
              onLoad("");
              setFileName(undefined);
            }}
          >
            <Trash size={13} />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="ssh-keyfile-btn"
            onClick={() => inputRef.current?.click()}
          >
            <UploadSimple size={14} weight="bold" />
            {hasStored ? replaceLabel : chooseLabel}
          </button>
          {hasStored && <span className="field-hint-text">{storedLabel}</span>}
        </>
      )}
    </div>
  );
}

