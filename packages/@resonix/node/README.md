# @resonix/node

Meta package that pulls in the platform-specific Resonix native binary (declared as an optional dependency) and exposes the cross‑platform `resonix` CLI.

## How it works

No build hooks, no `postinstall` script. A single runtime resolver `bin/resonix.js`:

1. Determines the expected package name from `process.platform` + `process.arch`.
2. (Optional override) If `RESONIX_PLATFORM_PKG` is set, that value wins (e.g. `RESONIX_PLATFORM_PKG=@resonix/linux-x86_64`).
3. Attempts to locate that package's `package.json`, then its `bin/` directory and the native executable inside.
4. If that fails (e.g., monorepo dev where multiple platform packages are present), it performs a prioritized scan over all known platform packages to find any installed binary matching the current platform/arch first.
5. Spawns the resolved native executable, passing through all CLI arguments and stdio.

If no supported binary can be found, it prints a warning and exits with code 1.

### Why optionalDependencies?

Only the matching platform package is actually installed by most package managers; the rest are skipped instead of causing install failures. This keeps installs clean and avoids conditional download logic in scripts.

### Supported targets

```
linux  (x64, arm64, armv7)
darwin (x64, arm64)
win32  (x64, arm64)
```

### Forcing / cross‑compiling

If you need to run the resolver against a specific platform binary (e.g. in CI artifacts or inside a container) set:

```bash
RESONIX_PLATFORM_PKG=@resonix/linux-x86_64 resonix --version
```

You are responsible for ensuring that binary is actually installed (e.g. via adding it as a direct dependency in that environment).

### Local monorepo development

When working inside this monorepo (or if multiple platform binary packages are present) the fallback scan means the first suitable binary will be used, prioritizing your current platform/arch. This makes local iteration easier without publishing every change.

## Installation

```bash
npm install @resonix/node --global
# or
pnpm install @resonix/node --global
# or
yarn global add @resonix/node
# or
bun add @resonix/node --global
```

You can also add it as a normal dependency and use `npx resonix` (or your package manager's equivalent) without global install.

## Usage

```bash
resonix --help
resonix --version
```

All arguments are forwarded directly to the underlying native binary.

## Troubleshooting

- Warning: "Unable to locate a platform-specific binary" – The optional dependency for your platform was likely skipped or pruned. Ensure:
  - You're on a supported OS/architecture.
  - Optional dependencies are not disabled (e.g. `--no-optional`).
  - You did not prune node_modules after install (some CI images prune optional deps by default).
- Force resolution: set `RESONIX_PLATFORM_PKG` explicitly (see above).
- Still stuck? List installed platform packages: `ls node_modules/@resonix` (PowerShell: `Get-ChildItem node_modules/@resonix`). There should be exactly one matching your platform.

## License

BSD-3-Clause
