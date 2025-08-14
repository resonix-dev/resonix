import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import fetch from "node-fetch";
import * as tar from "tar";
import extract from "extract-zip";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiUrl =
  "https://api.github.com/repos/resonix-dev/resonix-node/releases/latest";
const archDir = path.join(__dirname, "..", "packages", "@resonix");

const candidates = [
  "resonix-node-<version>-linux-aarch64.tar.gz",
  "resonix-node-<version>-linux-armv7.tar.gz",
  "resonix-node-<version>-linux-x86_64.tar.gz",
  "resonix-node-<version>-macos-aarch64.tar.gz",
  "resonix-node-<version>-macos-x86_64.tar.gz",
  "resonix-node-<version>-windows-aarch64.zip",
  "resonix-node-<version>-windows-x86_64.zip",
];

async function downloadFile(url, dest) {
  if (!url) throw new Error("No download URL provided");
  const res = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "resonix-downloader",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `Failed to download ${url} - ${res.status} ${res.statusText} - ${text}`,
    );
  }
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    res.body.pipe(file);
    file.on("finish", () => file.close(resolve));
    file.on("error", reject);
  });
}

async function extractArchive(archivePath, targetDir, isZip) {
  if (isZip) {
    await extract(archivePath, { dir: targetDir });
  } else {
    await tar.x({ file: archivePath, cwd: targetDir });
  }
}

function ensureExecutable(filePath) {
  try {
    if (os.platform() !== "win32") {
      const stat = fs.statSync(filePath);
      const mode = stat.mode | 0o755;
      fs.chmodSync(filePath, mode);
    }
  } catch (e) {
    console.warn("(i) Could not set executable permissions:", e.message);
  }
}

(async () => {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "resonix-downloader",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "<no body>");
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText} - ${text}`,
      );
    }
    const data = await response.json();
    const version = data.tag_name;
    const assets = data.assets;

    if (!Array.isArray(assets)) {
      throw new Error(
        "Release assets not found in API response (possibly rate limited or malformed response).",
      );
    }

    console.log(`(*) Latest resonix-node version: ${version}`);

    for (const pattern of candidates) {
      const candidate = pattern
        .replace("resonix-node-<version>-", "")
        .replace(".tar.gz", "")
        .replace(".zip", "");
      const fullName = pattern.replace("<version>", version);
      const isZip = fullName.endsWith(".zip");
      const asset = assets.find((a) => a.name === fullName);
      if (!asset) {
        console.warn(`(!) Asset not found: ${fullName}`);
        continue;
      }

      const downloadUrl = asset.browser_download_url || asset.url;

      const pkgFolder = path.join(archDir, candidate);
      const binFolder = path.join(pkgFolder, "bin");
      if (!fs.existsSync(binFolder))
        fs.mkdirSync(binFolder, { recursive: true });

      const osName = candidate.split("-")[0];
      const binaryName =
        osName === "windows" ? "resonix-node.exe" : "resonix-node";
      const binaryPath = path.join(binFolder, binaryName);

      const tempArchive = path.join(os.tmpdir(), `${fullName}`);

      try {
        await downloadFile(downloadUrl, tempArchive);
        await extractArchive(tempArchive, binFolder, isZip);
        if (!fs.existsSync(binaryPath)) {
          const entries = fs.readdirSync(binFolder);
          const found = entries.find(
            (e) => e === binaryName || e.startsWith("resonix-node"),
          );
          if (found && found !== binaryName) {
            fs.renameSync(path.join(binFolder, found), binaryPath);
          }
        }
        ensureExecutable(binaryPath);
        console.log(
          `${fs.existsSync(binaryPath) ? "(+) Installed/Updated" : "(?) Missing"} ${binaryPath}`,
        );
      } catch (e) {
        console.error(`(x) Failed processing ${fullName}: ${e.message}`);
      } finally {
        if (fs.existsSync(tempArchive)) {
          try {
            fs.unlinkSync(tempArchive);
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exitCode = 1;
  }
})();
