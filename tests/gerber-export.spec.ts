import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("exports fabrication-ready SVG silk, PCB reveal, and drill files", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
        <g data-name="Reveal">
          <circle cx="25" cy="25" r="16" fill="#111827"/>
        </g>
        <g data-name="Silk">
          <path d="M 55 10 L 90 25 L 55 40 Z" fill="#111827"/>
        </g>
      </svg>
    `;
    const file = new File([svg], "fabrication.svg", { type: "image/svg+xml" });
    const input = document.querySelector('input[accept*=".svg"]') as HTMLInputElement | null;
    if (!input) throw new Error("No artwork input");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const revealRow = page.locator(".object-row").filter({ hasText: "fabrication / Reveal" });
  await expect.poll(() => page.locator(".item-view.artwork path").count()).toBeGreaterThan(0);
  await revealRow.click();
  await page.getByLabel("Gerber", { exact: true }).selectOption("frontReveal");

  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByRole("button", { name: "Export Gerber and drill" }).click();
  await expect.poll(() => downloads.length).toBe(8);

  const files = new Map<string, string>();
  for (const download of downloads) {
    const path = await download.path();
    if (!path) throw new Error(`No path for ${download.suggestedFilename()}`);
    files.set(download.suggestedFilename(), await readFile(path, "utf8"));
  }

  const outline = files.get("eurorack-panel-Edge_Cuts.gbr") ?? "";
  const frontMask = files.get("eurorack-panel-F_Mask.gbr") ?? "";
  const frontSilk = files.get("eurorack-panel-F_Silk.gbr") ?? "";
  const drill = files.get("eurorack-panel.drl") ?? "";

  expect(outline).toContain("%TF.FileFunction,Profile,NP*%");
  expect(frontMask).toContain("%TF.FileFunction,Soldermask,Top*%");
  expect(frontMask).toContain("G36*");
  expect(frontMask).not.toContain("%ADD11R");
  expect(frontSilk).toContain("%TF.FileFunction,Legend,Top*%");
  expect(frontSilk).toContain("G36*");
  expect(drill).toContain(";FILE_FORMAT=3:3");
  expect(drill).toContain("; #@! TF.FileFunction,NonPlated,1,2,NPTH");
  expect(drill).toMatch(/^X\d+Y\d+$/m);
});
