#!/usr/bin/env node
// Dynamic runtime resolver for the @resonix/<platform> native binary.
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const matrix = {
  win32: { x64: "@resonix/windows-x86_64", arm64: "@resonix/windows-aarch64" },
  darwin: { x64: "@resonix/macos-x86_64", arm64: "@resonix/macos-aarch64" },
  linux: {
    x64: "@resonix/linux-x86_64",
    arm64: "@resonix/linux-aarch64",
    arm: "@resonix/linux-armv7",
  },
};

const candidates = [
  "@resonix/linux-x86_64",
  "@resonix/linux-aarch64",
  "@resonix/linux-armv7",
  "@resonix/macos-x86_64",
  "@resonix/macos-aarch64",
  "@resonix/windows-x86_64",
  "@resonix/windows-aarch64",
];

function expectedPackage() {
  if (process.env.RESONIX_PLATFORM_PKG) return process.env.RESONIX_PLATFORM_PKG;
  return (matrix[process.platform] || {})[process.arch] || null;
}

function resolveBinaryDir(pkgName) {
  try {
    const pkgJson = require.resolve(path.join(pkgName, "package.json"));
    const dir = path.join(path.dirname(pkgJson), "bin");
    if (fs.existsSync(dir)) return dir;
  } catch (_) {}
  return null;
}

function pickBinary() {
  let chosen = expectedPackage();
  let binDir = chosen && resolveBinaryDir(chosen);
  if (!binDir) {
    // Fallback scan with platform/arch prioritization for monorepo dev installs.
    const platformHint =
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : "linux";
    const archHint =
      process.arch === "arm64"
        ? "aarch64"
        : process.arch === "arm"
          ? "armv7"
          : "x86_64";
    const prioritized = [...candidates].sort((a, b) => {
      const score = (n) =>
        (n.includes(platformHint) ? 2 : 0) + (n.includes(archHint) ? 1 : 0);
      return score(b) - score(a);
    });
    for (const name of prioritized) {
      binDir = resolveBinaryDir(name);
      if (binDir) {
        chosen = name;
        break;
      }
    }
  }
  if (!binDir) return null;
  const entries = (() => {
    try {
      return fs.readdirSync(binDir);
    } catch {
      return [];
    }
  })();
  let binary = entries.find((e) => /resonix/i.test(e)) || entries[0];
  if (!binary) return null;
  return { pkg: chosen, path: path.join(binDir, binary) };
}

const resolved = pickBinary();
if (!resolved) {
  console.error(
    "[resonix] Unable to locate a platform-specific binary. Did installation skip optional deps?",
  );
  process.exitCode = 1;
  return;
}

const child = spawn(resolved.path, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code);
  }
});
