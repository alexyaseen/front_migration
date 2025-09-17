# Build & Release

This project targets two primary workflows: local development (Electron + TypeScript) and packaged desktop binaries via `electron-builder`.

## Prerequisites

- Node.js ≥ 16
- npm (ships with Node)
- Platform-specific tooling for packaging, as needed:
  - macOS: Xcode command line tools (`xcode-select --install`) for codesigning/notarization and icon scripts
  - ImageMagick (optional) for the squircle/icon helper scripts (`brew install imagemagick`)

## Development Loop

1. Install dependencies: `npm install`
2. Compile TypeScript: `npm run build`
3. Launch Electron with live runtime: `npm run electron`
   - This script compiles first, then runs Electron pointing to `electron/main.js`.
   - The renderer interacts with the compiled files in `dist/`.
4. Source changes in `src/` require re-running `npm run build`; consider `npx tsc --watch` in a separate terminal for incremental builds.

## TypeScript Configuration

- `tsconfig.json` targets ES2022, CommonJS modules, strict mode, declaration/source maps, and outputs to `dist/`.
- `@types/node` provides ambient Node types; additional type packages can be added as needed.

## Electron Builder Targets

Defined in `package.json` → `build`:

- `npm run dist` – Build TypeScript, prune dev deps, and package for the current platform.
- `npm run dist:mac` – macOS DMG + ZIP (`category: public.app-category.productivity`), hardened runtime, entitlements, optional notarization.
- `npm run dist:win` – Windows NSIS installer with `electron/logo.png` icon.
- `npm run dist:linux` – Linux AppImage with icon metadata.

All packaging scripts call `npm run build` first and prune devDependencies before invoking `electron-builder`.

## macOS Notarization & Stapling

- Controlled via `scripts/notarize.js` (`afterSign`) and `scripts/staple.js` (`afterAllArtifactBuild`).
- Enable notarization by providing either:
  - **App Store Connect API key**: set `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_FILE` (path to `.p8`).
  - **Apple ID + app-specific password**: set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and optional `APPLE_TEAM_ID`.
- Set `MAC_NOTARIZE=false` to skip notarization during local packaging.

## Reports in Packaged Builds

Packaged apps cannot write to the application directory; `electron/main.js` computes a writable `reports` folder under `app.getPath('userData')`. The renderer’s **Open Reports** button opens this location.

## Release Checklist

1. Increment version in `package.json` if shipping artifacts.
2. Ensure `npm run build` passes and TypeScript output is up to date.
3. On macOS, confirm Apple credentials are set if notarization is desired.
4. Run the appropriate `npm run dist[:platform]` command.
5. Test the generated artifact (DMG/AppImage/NSIS) on its target platform.
6. Distribute artifacts along with release notes and any environment setup instructions (Front token, Google credentials).

Following these steps keeps the desktop app reproducible and ready for operators across macOS, Windows, and Linux.
