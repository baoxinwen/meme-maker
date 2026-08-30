import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const defaultTemplatesDir = join(root, "public", "data", "templates");
const defaultGeneratedPublicDir = join(root, ".generated-public");
const defaultDistDir = join(root, "dist");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function generateContentAddressedAssets({
  templatesDir = defaultTemplatesDir,
  generatedPublicDir = defaultGeneratedPublicDir,
} = {}) {
  const rawIndex = JSON.parse(await readFile(join(templatesDir, "index.json"), "utf8"));
  await rm(generatedPublicDir, { recursive: true, force: true });

  const templates = [];
  for (const entry of rawIndex.templates) {
    const key = entry.key;
    const sourceDir = join(templatesDir, key);
    const files = (await collectFiles(sourceDir)).sort();
    const artifacts = [];

    for (const file of files) {
      const buffer = await readFile(file);
      const relativePath = relative(sourceDir, file).replace(/\\/g, "/");
      artifacts.push({ relativePath, buffer, hash: sha256(buffer) });
    }

    const revision = sha256(
      Buffer.from(artifacts.map((item) => `${item.relativePath}:${item.hash}`).join("\n")),
    );

    for (const artifact of artifacts) {
      const destination = join(
        generatedPublicDir,
        "data",
        "template-assets",
        key,
        revision,
        artifact.relativePath,
      );
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, artifact.buffer);
    }

    templates.push({ ...entry, revision });
  }

  const indexDestination = join(generatedPublicDir, "data", "templates", "index.json");
  await mkdir(dirname(indexDestination), { recursive: true });
  await writeFile(
    indexDestination,
    `${JSON.stringify({ version: rawIndex.version, templates }, null, 2)}\n`,
  );
}

async function installContentAddressedAssets({
  generatedPublicDir = defaultGeneratedPublicDir,
  distDir = defaultDistDir,
} = {}) {
  await cp(generatedPublicDir, distDir, { recursive: true });

  const legacyTemplatesDir = join(distDir, "data", "templates");
  const entries = await readdir(legacyTemplatesDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => rm(join(legacyTemplatesDir, entry.name), { recursive: true, force: true })),
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--install")) {
    await installContentAddressedAssets();
  } else {
    await generateContentAddressedAssets();
  }
}

export { generateContentAddressedAssets, installContentAddressedAssets };
