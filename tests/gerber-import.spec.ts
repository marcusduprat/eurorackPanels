import { expect, test } from "@playwright/test";
import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const supported = new Set([".gbr", ".ger", ".gtl", ".gbl", ".gto", ".gbo", ".gko", ".gm1", ".drl", ".xln", ".dxf", ".zip"]);

test("imports real Gerber and drill files through the app UI", async ({ page }) => {
  const target = process.env.GERBER_IMPORT_TARGET;
  test.skip(!target, "Set GERBER_IMPORT_TARGET to a Gerber file or folder to run this smoke test.");

  const files = collectGerberFiles(resolve(target));
  expect(files, `No supported Gerber/drill/DXF files found in ${target}`).not.toHaveLength(0);

  const consoleProblems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleProblems.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleProblems.push(error.message);
  });

  await page.goto("/");
  await expect(page).toHaveTitle("Eurorack Panel Bench");
  await expect(page.getByText("Panel Objects")).toBeVisible();

  const layerRows = page.locator(".layer-row");
  const initialLayerCount = await layerRows.count();
  await page.locator('input[accept*=".gbr"]').setInputFiles(files);

  await expect.poll(() => layerRows.count()).toBeGreaterThan(initialLayerCount);
  await expect(page.locator(".panel-canvas")).toBeVisible();

  const layerText = await page.locator(".layer-list").innerText();
  if (extname(files[0]).toLowerCase() !== ".zip") {
    expect(layerText).toContain(basename(files[0]).replace(/\.[^.]+$/, ""));
  } else {
    expect(layerText).toContain("shapes");
  }

  await expect.poll(() => page.locator(".gerber-layer-batch").count()).toBeGreaterThan(0);
  await expect(page.locator(".gerber-layers line, .gerber-layers circle, .gerber-layers rect")).toHaveCount(0);
  expect(consoleProblems).toEqual([]);

  if (process.env.PLAYWRIGHT_SMOKE_SCREENSHOT) {
    await page.screenshot({ path: process.env.PLAYWRIGHT_SMOKE_SCREENSHOT, fullPage: false });
  }
});

function collectGerberFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) {
    return supported.has(extname(path).toLowerCase()) ? [path] : [];
  }

  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) return collectGerberFiles(fullPath);
      if (!entry.isFile()) return [];
      return supported.has(extname(entry.name).toLowerCase()) ? [fullPath] : [];
    })
    .sort();
}
