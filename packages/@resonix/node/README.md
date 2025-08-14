# @resonix/node

Meta package that pulls in the platform-specific Resonix node binary (as an optional dependency) and exposes a cross-platform `resonix` CLI.

## How it works

This package declares optionalDependencies on all supported platform-specific binary packages (`@resonix/<platform-arch>`). Your package manager will install only the one matching your OS/architecture. During `postinstall`, a script locates the installed platform package and writes a small shim script to `bin/resonix` (and a Node.js wrapper `bin/resonix.js`) so that the declared `bin` entry resolves to the correct native binary.

If no supported binary is installed (e.g., unsupported platform), the CLI will be a no-op and will print a warning.

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

## Usage

After installing:

```bash
resonix --version
```

## Troubleshooting

- If you see a warning that no platform-specific binary was found, ensure you're on a supported OS/architecture and using a compatible Node.js version.
- For custom environments (e.g., bundlers, Electron), you might need to ensure optional dependencies are not pruned.

## License

BSD-3-Clause
