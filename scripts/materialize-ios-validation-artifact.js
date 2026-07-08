#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const TRUSTED_EVIDENCE_REPOSITORIES = [
  "opsiclear/diveo",
  "opsiclear-web/diveo",
  "opsiclear/gsav-hosting",
];

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    url: env.IOS_VALIDATION_ARTIFACT_URL || "",
    outputPath: env.IOS_VALIDATION_ARTIFACT_OUTPUT_PATH || "",
    expectedSha256: env.IOS_VALIDATION_ARTIFACT_SHA256 || "",
    token: env.GITHUB_TOKEN || env.GH_TOKEN || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a non-empty value.`);
    if (!(key in options)) throw new Error(`Unknown option: ${arg}`);
    options[key] = value;
    index += 1;
  }

  if (!options.url) throw new Error("--url or IOS_VALIDATION_ARTIFACT_URL is required.");
  if (!options.outputPath) throw new Error("--output-path or IOS_VALIDATION_ARTIFACT_OUTPUT_PATH is required.");
  if (!/^[a-f0-9]{64}$/i.test(options.expectedSha256)) {
    throw new Error("--expected-sha256 or IOS_VALIDATION_ARTIFACT_SHA256 must be a 64-hex SHA256.");
  }
  return options;
}

function normalizeSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function githubHeaders(token, extra = {}) {
  return {
    "User-Agent": "diveo-device-validation",
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function githubUrlParts(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("iOS validation artifact URL must be a valid URL.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
    throw new Error("iOS validation artifact URL must be an https://github.com URL.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const repository = parts.slice(0, 2).join("/").toLowerCase();
  if (!TRUSTED_EVIDENCE_REPOSITORIES.includes(repository)) {
    throw new Error("iOS validation artifact URL must be under a trusted evidence repository.");
  }
  return {
    owner: parts[0],
    repo: parts[1],
    repository,
    rest: parts.slice(2),
  };
}

function apiUrl({ owner, repo }, apiPath) {
  return `https://api.github.com/repos/${owner}/${repo}${apiPath}`;
}

function outputArtifactName(outputPath) {
  const base = path.basename(outputPath);
  return base.toLowerCase().endsWith(".zip") ? base.slice(0, -4) : base;
}

function selectArtifact(artifacts, desiredName) {
  const active = artifacts.filter((artifact) => artifact.expired !== true);
  const exact = active.filter((artifact) => artifact.name === desiredName);
  if (exact.length === 1) return exact[0];
  const zipName = `${desiredName}.zip`;
  const zipExact = active.filter((artifact) => artifact.name === zipName);
  if (zipExact.length === 1) return zipExact[0];
  throw new Error(`Could not identify one iOS validation artifact named ${desiredName}.`);
}

async function resolveDownloadPlan(url, {
  outputPath = "",
  token = "",
  fetchJson = defaultFetchJson,
} = {}) {
  const parts = githubUrlParts(url);
  const [kind, subkind, third, fourth, ...tail] = parts.rest;

  if (kind === "blob" && subkind && third) {
    return {
      type: "direct",
      url: `https://raw.githubusercontent.com/${parts.owner}/${parts.repo}/${subkind}/${[third, fourth, ...tail].filter(Boolean).join("/")}`,
      headers: githubHeaders(token, { Accept: "application/octet-stream" }),
    };
  }

  if (kind === "releases" && subkind === "download" && third && fourth) {
    return {
      type: "direct",
      url,
      headers: githubHeaders(token, { Accept: "application/octet-stream" }),
    };
  }

  if (kind === "releases" && subkind === "tag" && third) {
    throw new Error("iOS validation artifact URL must point to a direct Actions artifact, release asset download, or docs/qa-evidence blob, not a release tag page.");
  }

  if (kind === "actions" && subkind === "runs" && third && fourth === "artifacts" && tail[0]) {
    const artifactRef = tail[0];
    if (/^\d+$/.test(artifactRef)) {
      return {
        type: "api-artifact",
        url: apiUrl(parts, `/actions/artifacts/${artifactRef}/zip`),
        headers: githubHeaders(token, { Accept: "application/vnd.github+json" }),
      };
    }
    const listing = await fetchJson(apiUrl(parts, `/actions/runs/${third}/artifacts`), token);
    const artifact = selectArtifact(listing.artifacts ?? [], artifactRef);
    return {
      type: "api-artifact",
      url: apiUrl(parts, `/actions/artifacts/${artifact.id}/zip`),
      headers: githubHeaders(token, { Accept: "application/vnd.github+json" }),
    };
  }

  if (kind === "actions" && subkind === "runs" && third) {
    throw new Error("iOS validation artifact URL must point to a direct Actions artifact, release asset download, or docs/qa-evidence blob, not a bare Actions run.");
  }

  throw new Error("Unsupported iOS validation artifact URL shape.");
}

function defaultFetchJson(url, token) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: githubHeaders(token) }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub API request failed ${response.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function defaultDownloadUrl(url, outputPath, headers, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error("Too many redirects while downloading iOS artifact."));
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(defaultDownloadUrl(new URL(response.headers.location, url).toString(), outputPath, headers, redirects + 1));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          reject(new Error(`iOS artifact download failed ${response.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 200)}`));
        });
        return;
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const stream = fs.createWriteStream(outputPath);
      response.pipe(stream);
      stream.on("finish", () => stream.close(resolve));
      stream.on("error", reject);
    });
    request.on("error", reject);
  });
}

async function materializeIosValidationArtifact({
  url,
  outputPath,
  expectedSha256,
  token = "",
  fetchJson = defaultFetchJson,
  downloadUrl = defaultDownloadUrl,
} = {}) {
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    const existingSha256 = sha256File(outputPath);
    if (existingSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(`Existing iOS artifact SHA256 ${existingSha256} does not match expected ${expectedSha256}.`);
    }
    return {
      status: "already-present",
      outputPath: normalizeSlash(outputPath),
      sha256: existingSha256,
    };
  }

  const plan = await resolveDownloadPlan(url, { outputPath, token, fetchJson });
  await downloadUrl(plan.url, outputPath, plan.headers);
  const actualSha256 = sha256File(outputPath);
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`Downloaded iOS artifact SHA256 ${actualSha256} does not match expected ${expectedSha256}.`);
  }
  return {
    status: "downloaded",
    outputPath: normalizeSlash(outputPath),
    sourceType: plan.type,
    sha256: actualSha256,
  };
}

async function main() {
  try {
    const options = parseArgs();
    const result = await materializeIosValidationArtifact(options);
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      ok: true,
      ...result,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  githubUrlParts,
  materializeIosValidationArtifact,
  outputArtifactName,
  parseArgs,
  resolveDownloadPlan,
  selectArtifact,
  sha256File,
};
