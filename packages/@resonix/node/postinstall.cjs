/* Postinstall script: resolves which optional platform-specific package got installed and writes a small shim script pointing to its binary. */
const fs = require("fs");
const path = require("path");

// All possible platform packages (order no longer used for selection logic)
const candidates = [
  "@resonix/linux-x86_64",
  "@resonix/linux-aarch64",
  "@resonix/linux-armv7",
  "@resonix/macos-x86_64",
  "@resonix/macos-aarch64",
  "@resonix/windows-x86_64",
  "@resonix/windows-aarch64",
];

// Matrix mapping of platform+arch to the expected package name.
const matrix = {
  win32: { x64: "@resonix/windows-x86_64", arm64: "@resonix/windows-aarch64" },
  darwin: { x64: "@resonix/macos-x86_64", arm64: "@resonix/macos-aarch64" },
  linux: {
    x64: "@resonix/linux-x86_64",
    arm64: "@resonix/linux-aarch64",
    arm: "@resonix/linux-armv7",
  },
};

function pickExpectedPackage() {
  // Allow explicit override via env var (handy for testing / cross builds)
  if (process.env.RESONIX_PLATFORM_PKG) return process.env.RESONIX_PLATFORM_PKG;
  const byPlatform = matrix[process.platform];
  if (!byPlatform) return null;
  return byPlatform[process.arch] || null;
}

function resolveBinaryDir(pkgName) {
  try {
    const pkgPath = require.resolve(path.join(pkgName, "package.json"));
    const pkgDir = path.dirname(pkgPath);
    const binDir = path.join(pkgDir, "bin");
    if (fs.existsSync(binDir)) return binDir;
  } catch (e) {
    // ignore missing packages
  }
  return null;
}

let foundBinDir = null;
let chosenPkg = pickExpectedPackage();

if (chosenPkg) {
  foundBinDir = resolveBinaryDir(chosenPkg);
  if (!foundBinDir) {
    // Fallback: maybe optionalDependencies filtering behaved differently in a workspace context.
    chosenPkg = null; // trigger fallback scan
  }
}

if (!foundBinDir) {
  // Fallback legacy behavior: scan all candidates and pick the first that exists, but prefer
  // those matching current platform substring to avoid picking the wrong OS if all are present (e.g. in a monorepo dev checkout).
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
    const dir = resolveBinaryDir(name);
    if (dir) {
      foundBinDir = dir;
      chosenPkg = name;
      break;
    }
  }
}

if (!foundBinDir) {
  console.warn(
    "[resonix] No platform-specific binary package installed. The resonix CLI will not work.",
  );
  process.exit(0);
}

// Create bin directory and shim
const ourBinDir = path.join(__dirname, "bin");
if (!fs.existsSync(ourBinDir)) fs.mkdirSync(ourBinDir, { recursive: true });

// Determine actual binary file inside foundBinDir (pick first executable file) -- adjust if naming is known
let binaryFile = null;
try {
  const entries = fs.readdirSync(foundBinDir);
  for (const entry of entries) {
    if (/resonix/i.test(entry)) {
      binaryFile = entry;
      break;
    }
  }
  if (!binaryFile && entries.length) binaryFile = entries[0];
} catch (e) {}

if (!binaryFile) {
  console.warn("[resonix] Could not locate binary inside " + foundBinDir);
  process.exit(0);
}

const targetPath = path.join(foundBinDir, binaryFile);

const isWin = process.platform === "win32";
const shimPath = path.join(ourBinDir, "resonix" + (isWin ? ".cmd" : ""));

if (isWin) {
  fs.writeFileSync(
    shimPath,
    `@ECHO OFF\n"%~dp0..\\..\\${targetPath.replace(/:/g, "")?.replace(/\\/g, "\\\\")}" %*`,
  );
} else {
  fs.writeFileSync(
    shimPath,
    `#!/usr/bin/env bash\n"$(dirname "$0")/../../${path.relative(ourBinDir, targetPath)}" "$@"`,
  );
  fs.chmodSync(shimPath, 0o755);
}

// Also create a JS shim for the declared bin (resonix -> bin/resonix.js)
const jsShim = path.join(ourBinDir, "resonix.js");
fs.writeFileSync(
  jsShim,
  `#!/usr/bin/env node\nrequire('child_process').spawnSync(${JSON.stringify(targetPath)}, process.argv.slice(2), { stdio: 'inherit' });`,
);
fs.chmodSync(jsShim, 0o755);

console.log(
  "[resonix] Using binary from " +
    targetPath +
    (chosenPkg ? ` (package: ${chosenPkg})` : ""),
);
