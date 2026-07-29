import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

test("loads installed font families and applies one to selected text", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: async function (this: Window) {
        if (this !== window) throw new TypeError("Illegal invocation");
        return [
          { family: "Times New Roman", fullName: "Times New Roman", postscriptName: "TimesNewRomanPSMT", style: "Regular" },
          { family: "Times New Roman", fullName: "Times New Roman Bold", postscriptName: "TimesNewRomanPS-BoldMT", style: "Bold" },
          { family: "times new roman", fullName: "Times New Roman Italic", postscriptName: "TimesNewRomanPS-ItalicMT", style: "Italic" },
          { family: "DIN Condensed", fullName: "DIN Condensed Bold", postscriptName: "DINCondensed-Bold", style: "Bold" },
          { family: "Courier New", fullName: "Courier New", postscriptName: "CourierNewPSMT", style: "Regular" },
        ];
      },
    });
  });
  await page.goto("/");

  await page.locator(".object-row").filter({ hasText: "Title" }).click();
  await page.getByRole("button", { name: "Load computer fonts" }).click();

  await expect(page.getByText("3 computer font families loaded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Courier New", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search fonts" }).fill("Times");
  const localFont = page.getByRole("button", { name: "Times New Roman" });
  await expect(localFont).toBeVisible();
  await localFont.click();

  await expect(localFont).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Text" }).fill("jazz");
  await page.getByLabel("Italic").check();
  const editorText = page.locator(".panel-items text").filter({ hasText: "jazz" });
  await expect(editorText).toHaveAttribute("font-family", '"Times New Roman"');
  const editorBounds = await editorText.evaluate((element: SVGGraphicsElement) => {
    const bounds = element.getBBox();
    return { minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height };
  });

  await page.locator(".object-row").filter({ hasText: "Cutoff" }).click();
  await page.locator(".object-row").filter({ hasText: "Title" }).click();
  await expect(page.getByRole("searchbox", { name: "Search fonts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload computer fonts" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("No saved project");
  const project = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
  expect(project.items.find((item: { label: string }) => item.label === "Title").fontFamily).toBe('"Times New Roman"');

  const gerberDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Gerber and drill" }).click();
  const gerberDownload = await gerberDownloadPromise;
  const gerberPath = await gerberDownload.path();
  if (!gerberPath) throw new Error("No Gerber ZIP");
  const zip = await JSZip.loadAsync(await readFile(gerberPath));
  const frontSilk = await zip.file("eurorack-panel.GTO")?.async("string");
  expect(frontSilk).toBeTruthy();
  expect(frontSilk).toContain("G36*");
  const coordinates = [...frontSilk!.matchAll(/X(\d+)Y(\d+)D0[12]\*/g)].map((match) => ({
    x: Number(match[1]) / 1_000_000,
    y: Number(match[2]) / 1_000_000,
  }));
  expect(coordinates.length).toBeGreaterThan(20);
  const gerberBounds = {
    minX: Math.min(...coordinates.map((point) => point.x)),
    minY: Math.min(...coordinates.map((point) => point.y)),
    maxX: Math.max(...coordinates.map((point) => point.x)),
    maxY: Math.max(...coordinates.map((point) => point.y)),
  };
  const editorInkCenterX = (editorBounds.minX + editorBounds.maxX) / 2;
  const gerberInkCenterX = (gerberBounds.minX + gerberBounds.maxX) / 2;
  expect(gerberInkCenterX - 30.48).toBeCloseTo(editorInkCenterX - 30.48, 1);
  expect(Math.abs((project.settings.heightMm - gerberBounds.maxY) - editorBounds.minY)).toBeLessThan(0.25);
});

test("explains when the browser cannot enumerate computer fonts", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");

  await page.locator(".object-row").filter({ hasText: "Title" }).click();
  await expect(page.getByRole("button", { name: "Load computer fonts" })).toBeDisabled();
  await expect(page.getByText("Available in desktop Chrome and Edge.")).toBeVisible();
});
