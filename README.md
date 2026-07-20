<div align="center">

<img src="apps/extension/media/icon.png" width="88" alt="Luno Code" />

# Luno Code

**Open-source AI coding agent for VS Code.** Chat & Agent modes, multi-file edits behind an approval gate you control, SSH remote execution, and a Telegram mini-app to drive it from your phone — with Claude, GPT & Gemini under one flat-rate key.

[Website](https://luno.codes) · [Models](https://luno.codes/models) · [Docs](https://luno.codes/docs) · [Support](https://luno.codes/support)

</div>

---

## Highlights

- **Agent mode** — plans, edits multi-file projects, runs commands and tests, loops until done. Every tool call is a visible, expandable step with diffs before writes.
- **Chat mode** — streamed answers, a model switcher, and native image/PDF/file attachments.
- **Approval gate** — write/edit/shell tools wait for your click, or ride a trusted-command allow-list.
- **SSH remote execution** — run commands on your own servers; credentials stay in OS secret storage.
- **Luno Remote** — pair a phone and control the same agent from a Telegram mini-app.
- **English & Russian UI.**

## Monorepo layout

```
apps/
  extension/          VS Code extension host (TypeScript, esbuild)
  extension-webview/  Chat sidebar UI (React + Vite)
  gateway/            Local dev harness implementing the Luno gateway contract
packages/
  shared/             Types & contracts shared between extension, webview, gateway
docs/                 Architecture & feature docs
```

The extension talks to the hosted Luno gateway in production; `apps/gateway` is a
self-contained local server that speaks the same contract so you can run the whole
extension end-to-end offline while developing.

## Development

```bash
npm install          # install all workspaces
npm run build        # build everything
npm run dev:gateway  # (optional) start the local gateway harness
# then press F5 in VS Code to launch the Extension Development Host
```

Requirements: Node ≥ 20, VS Code ≥ 1.90.

## Contributing

Contributions are welcome — issues, ideas, and pull requests. Fork the repo, open a PR, and join us. Thanks to everyone helping make Luno Code better:

- [@UvenaliyS](https://github.com/UvenaliyS)
- [@ivangribach](https://github.com/ivangribach)

## License

[MIT](LICENSE) © 2026 Luno Code.
