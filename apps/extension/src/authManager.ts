import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { GatewayClient } from "./gatewayClient";
import type { AccountProfile, PlanId } from "./types";

const KEY_SECRET = "luno.apiKey";
const KEY_PLAN = "luno.plan";
const KEY_PROFILE = "luno.profile";

/**
 * Owns the API key and plan, persisted in VS Code Secret Storage (spec §1) —
 * never in settings.json, never synced via Settings Sync.
 */
export class AuthManager {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _apiKey: string | undefined;
  private plan: PlanId | undefined;
  private _profile: AccountProfile | undefined;
  private linkCancelled = false;
  /** CSRF nonce for the in-flight browser-OAuth attempt. */
  private oauthState: string | undefined;
  /** Slow profile poll (avatar/plan freshness). */
  private profileTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gateway: GatewayClient,
  ) {}

  /** Load a previously stored key/plan on activation. */
  async init(): Promise<void> {
    this._apiKey = await this.context.secrets.get(KEY_SECRET);
    this.plan = this.context.globalState.get<PlanId>(KEY_PLAN);
    this._profile = this.context.globalState.get<AccountProfile>(KEY_PROFILE);
    this.gateway.setApiKey(this._apiKey);
    // A revoked/expired key must drop the account: the gateway calls this on a
    // 401/403 to any Luno endpoint made WITH a key. Guarded so we don't loop.
    this.gateway.setAuthInvalidHandler(() => {
      if (this._apiKey) {
        void vscode.window.showWarningMessage(
          "Luno: your API key is no longer valid — you've been signed out.",
        );
        void this.logout();
      }
    });
    // Refresh the cabinet profile in the background; the cached copy renders
    // instantly and the update lands via onDidChange. Then keep it fresh with
    // a slow poll — avatar/plan changes on the site show up within minutes
    // instead of only after a VS Code restart.
    if (this._apiKey) void this.refreshProfile();
    this.profileTimer = setInterval(
      () => {
        if (this._apiKey) void this.refreshProfile();
      },
      5 * 60 * 1000,
    );
  }

  dispose(): void {
    if (this.profileTimer) clearInterval(this.profileTimer);
  }

  /** Fetch name/email/avatar from the cabinet. Best-effort: the cached copy
   *  stays when the gateway is unreachable. */
  private async refreshProfile(): Promise<void> {
    try {
      const fresh = await this.gateway.getProfile();
      // Only fire listeners when something actually changed — the poll runs
      // forever and idle change events would re-render the webview for nothing.
      if (JSON.stringify(fresh) !== JSON.stringify(this._profile)) {
        this._profile = fresh;
        await this.context.globalState.update(KEY_PROFILE, this._profile);
        this._onDidChange.fire();
      }
    } catch {
      /* offline / older gateway — keep the cache */
    }
  }

  get isAuthed(): boolean {
    return !!this._apiKey;
  }

  get currentPlan(): PlanId | undefined {
    return this.plan;
  }

  /** The active Luno session key, if signed in. */
  get apiKey(): string | undefined {
    return this._apiKey;
  }

  /** Telegram username when linked; undefined when anonymous. */
  get account(): string | undefined {
    return this.plan ? "telegram" : undefined;
  }

  /** Cabinet profile (name/email/avatar), cached across restarts. */
  get profile(): AccountProfile | undefined {
    return this._profile;
  }

  async setSession(apiKey: string, plan: PlanId): Promise<void> {
    this._apiKey = apiKey;
    this.plan = plan;
    await this.context.secrets.store(KEY_SECRET, apiKey);
    await this.context.globalState.update(KEY_PLAN, plan);
    this.gateway.setApiKey(apiKey);
    this._onDidChange.fire();
    void this.refreshProfile();
  }

  async logout(): Promise<void> {
    this._apiKey = undefined;
    this.plan = undefined;
    this._profile = undefined;
    await this.context.secrets.delete(KEY_SECRET);
    await this.context.globalState.update(KEY_PLAN, undefined);
    await this.context.globalState.update(KEY_PROFILE, undefined);
    this.gateway.setApiKey(undefined);
    this._onDidChange.fire();
  }

  /**
   * Run the device-code login flow (spec §1): obtain a short code, surface it
   * (inline in the webview via `onChallenge`, plus a convenience notification),
   * then poll until approved.
   *
   * @param channel "telegram" opens @LunoBot; "web" opens the studio.luno.codes
   *   personal cabinet. Both poll the same /auth/device/poll endpoint.
   * @param onChallenge called once the code is issued, so the webview can show
   *   the code + QR. Cancellation is driven by `cancelLink()`.
   */
  async login(
    channel: "telegram" | "web" = "telegram",
    onChallenge?: (c: {
      channel: "telegram" | "web";
      userCode: string;
      verificationUri: string;
      webVerificationUri: string;
    }) => void,
  ): Promise<boolean> {
    const start = await this.gateway.startDeviceCode();
    this.linkCancelled = false;

    onChallenge?.({
      channel,
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      webVerificationUri: start.webVerificationUri,
    });

    const uri =
      channel === "web" ? start.webVerificationUri : start.verificationUri;
    const open = channel === "web" ? "Open studio.luno.codes" : "Open @LunoBot";
    void vscode.window
      .showInformationMessage(
        `Luno: enter code ${start.userCode} to sign in.`,
        open,
      )
      .then((choice) => {
        if (choice === open) {
          void vscode.env.openExternal(vscode.Uri.parse(uri));
        }
      });

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Luno: waiting for approval (code ${start.userCode})`,
        cancellable: true,
      },
      async (_progress, token) => {
        const deadline = Date.now() + start.expiresIn * 1000;
        while (Date.now() < deadline) {
          if (token.isCancellationRequested || this.linkCancelled) return false;
          await delay(start.interval * 1000);
          const status = await this.gateway.pollDeviceCode(start.deviceCode);
          if (status.status === "approved") {
            await this.setSession(status.apiKey, status.plan);
            void vscode.window.showInformationMessage(
              `Luno: signed in on ${status.plan}.`,
            );
            return true;
          }
          if (status.status === "denied" || status.status === "expired") {
            void vscode.window.showErrorMessage(
              `Luno: sign-in ${status.status}.`,
            );
            return false;
          }
        }
        return false;
      },
    );
  }

  /** Cancel an in-flight device-code login (from the inline panel). */
  cancelLink(): void {
    this.linkCancelled = true;
  }

  /**
   * Link by pasting an API key from the personal cabinet. Validates the key
   * against the gateway, then stores the session on success.
   */
  async loginWithKey(key: string): Promise<boolean> {
    const trimmed = key.trim();
    if (!trimmed) return false;
    const { valid, plan } = await this.gateway.verifyKey(trimmed);
    if (!valid) {
      void vscode.window.showErrorMessage("Luno: that API key is not valid.");
      return false;
    }
    await this.setSession(trimmed, plan ?? "STARTER");
    void vscode.window.showInformationMessage(
      `Luno: signed in${plan ? ` on ${plan}` : ""}.`,
    );
    return true;
  }

  /**
   * Begin browser OAuth: open the cabinet's authorize page with a CSRF `state`
   * nonce and a vscode:// redirect. The site redirects back to our UriHandler
   * (see extension.ts) with `state` + a one-time `token`.
   */
  startBrowserOAuth(studioBaseUrl: string, redirectUri: string): void {
    this.oauthState = randomUUID();
    const url =
      `${studioBaseUrl.replace(/\/+$/, "")}/oauth/authorize` +
      `?redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(this.oauthState)}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /**
   * Complete browser OAuth from the vscode:// callback. Verifies `state` to
   * reject forged callbacks, then exchanges the one-time token for a key.
   */
  async completeBrowserOAuth(token: string, state: string): Promise<boolean> {
    if (!this.oauthState || state !== this.oauthState) {
      void vscode.window.showErrorMessage(
        "Luno: sign-in rejected (state mismatch). Please try again.",
      );
      return false;
    }
    this.oauthState = undefined;
    try {
      const { apiKey, plan } = await this.gateway.oauthExchange(token);
      await this.setSession(apiKey, plan);
      void vscode.window.showInformationMessage(`Luno: signed in on ${plan}.`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Luno: sign-in failed — ${message}`);
      return false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
