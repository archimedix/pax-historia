# Changelog

All notable changes to this fork are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Server-managed AI models.** The server can now expose a catalog of
  pre-configured models (`server/config/serverModels.json`) and proxy chat
  completions to OpenAI-compatible upstreams (OpenRouter, OpenAI, …). API keys
  live in `.env` and stay server-side — they are never sent to the browser.
  A new "Server" provider in the settings panel lets you pick one of the
  configured models from a dropdown (no key field). When no key is configured
  the catalog is empty and every existing provider keeps working as before.
- Minimal zero-dependency `.env` loader (`server/env.js`) and `.env.example`.
- Dev proxy in `vite.config.ts` so `npm run dev` reaches the backend on `:3000`.

### Changed
- Consolidated fork-hygiene work onto `main`: ignore `.env`, remove stray empty
  files, add `CLAUDE.md`.
