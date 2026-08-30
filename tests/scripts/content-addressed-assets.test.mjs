import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import * as assetGenerator from "../../scripts/generate-content-addressed-assets.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "meme-maker-assets-"));
  temporaryDirectories.push(root);
  const templatesDir = join(root, "templates");
  const generatedPublicDir = join(root, "generated-public");
  const distDir = join(root, "dist");
  const sourceDir = join(templatesDir, "sample");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    join(templatesDir, "index.json"),
    JSON.stringify({
      version: "1.0.0",
      templates: [
        {
          key: "sample",
          type: "IMG",
          length: 1,
          alias: [],
          description: "测试模板",
        },
      ],
    }),
  );
  await writeFile(join(sourceDir, "data.json"), JSON.stringify({ type: "IMG" }));
  await writeFile(join(sourceDir, "0.png"), Buffer.from([1, 2, 3, 4]));
  return { templatesDir, generatedPublicDir, distDir };
}

describe("内容寻址模板构建", () => {
  it("Docker 构建上下文保留生产构建脚本", async () => {
    const dockerignore = await readFile(new URL("../../.dockerignore", import.meta.url), "utf8");
    const ignoredEntries = dockerignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    expect(ignoredEntries).not.toContain("scripts");
  });

  it("提供独立安装步骤并移除生产包中的旧模板目录", async () => {
    expect(assetGenerator.installContentAddressedAssets).toBeTypeOf("function");
    if (typeof assetGenerator.installContentAddressedAssets !== "function") return;

    const fixture = await createFixture();
    await assetGenerator.generateContentAddressedAssets(fixture);
    const generatedIndex = JSON.parse(
      await readFile(join(fixture.generatedPublicDir, "data", "templates", "index.json"), "utf8"),
    );
    const revision = generatedIndex.templates[0].revision;
    expect(revision).toMatch(/^[a-f0-9]{64}$/);

    const legacyDir = join(fixture.distDir, "data", "templates", "sample");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "0.png"), "legacy");

    await assetGenerator.installContentAddressedAssets(fixture);

    await expect(access(legacyDir)).rejects.toThrow();
    await expect(
      readFile(join(fixture.distDir, "data", "template-assets", "sample", revision, "0.png")),
    ).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
    const installedIndex = JSON.parse(
      await readFile(join(fixture.distDir, "data", "templates", "index.json"), "utf8"),
    );
    expect(installedIndex.templates[0].revision).toBe(revision);
  });
});
