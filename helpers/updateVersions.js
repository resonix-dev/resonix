import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

const rootDir = path.join(process.cwd());
const packagesDir = path.join(rootDir, "packages", "@resonix");
const metaPackageDir = path.join(packagesDir, "node");
const clientPackageDir = path.join(rootDir, "packages", "resonix");
const apiUrl =
  "https://api.github.com/repos/resonix-dev/resonix-node/releases/latest";

async function getLatestTag() {
  const res = await fetch(apiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "resonix-auto-updater",
    },
  });
  if (!res.ok)
    throw new Error("GitHub API error " + res.status + " " + res.statusText);
  const data = await res.json();
  return data.tag_name?.replace(/^v/, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

async function main() {
  const latest = await getLatestTag();
  if (!latest) throw new Error("Could not resolve latest tag");
  console.log("[info] Latest upstream resonix-node version: " + latest);

  const archPackages = fs
    .readdirSync(packagesDir)
    .filter((f) => !f.startsWith("."))
    .filter((f) => fs.statSync(path.join(packagesDir, f)).isDirectory());
  const samplePkgJsonPath = path.join(
    packagesDir,
    archPackages.find((p) => p !== "node"),
    "package.json",
  );
  const samplePkg = readJson(samplePkgJsonPath);
  const currentVersion = samplePkg.version.replace(/^v/, "");
  console.log("[info] Current monorepo version: " + currentVersion);

  if (currentVersion === latest) {
    console.log("[info] Already up to date. Exiting.");
    return { changed: false };
  }

  const rootPkgPath = path.join(rootDir, "package.json");
  const rootPkg = readJson(rootPkgPath);
  rootPkg.version = latest;
  writeJson(rootPkgPath, rootPkg);

  for (const pkgName of archPackages) {
    const dir = path.join(packagesDir, pkgName);
    const pkgJsonPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkg = readJson(pkgJsonPath);
    pkg.version = latest;
    writeJson(pkgJsonPath, pkg);
    console.log("[update] " + pkg.name + " -> " + latest);
  }

  const metaPkgPath = path.join(metaPackageDir, "package.json");
  const metaPkg = readJson(metaPkgPath);
  if (metaPkg.optionalDependencies) {
    for (const dep of Object.keys(metaPkg.optionalDependencies)) {
      metaPkg.optionalDependencies[dep] = latest;
    }
  }
  metaPkg.version = latest;
  writeJson(metaPkgPath, metaPkg);
  console.log("[update] meta package versions updated");

  const clientPkgPath = path.join(clientPackageDir, "package.json");
  const clientPkg = readJson(clientPkgPath);
  clientPkg.version = latest;
  writeJson(clientPkgPath, clientPkg);
  console.log("[update] client package version updated");

  return { changed: true, latest };
}

main()
  .then((r) => {
    if (r?.changed) {
      console.log("[done] Versions updated to " + r.latest);
    }
  })
  .catch((err) => {
    console.error("[error] " + err.message);
    process.exitCode = 1;
  });
