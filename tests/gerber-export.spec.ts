import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

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

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Gerber and drill" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("eurorack-panel-gerbers.zip");

  const path = await download.path();
  if (!path) throw new Error("No path for Gerber ZIP");
  const zip = await JSZip.loadAsync(await readFile(path));
  const readZipText = async (name: string) => (await zip.file(name)?.async("string")) ?? "";

  expect(Object.keys(zip.files).sort()).toEqual([
    "eurorack-panel.GBL",
    "eurorack-panel.GBO",
    "eurorack-panel.GBS",
    "eurorack-panel.GKO",
    "eurorack-panel.GTL",
    "eurorack-panel.GTO",
    "eurorack-panel.GTS",
    "eurorack-panel.XLN",
  ]);
  const outline = await readZipText("eurorack-panel.GKO");
  const frontMask = await readZipText("eurorack-panel.GTS");
  const frontSilk = await readZipText("eurorack-panel.GTO");
  const drill = await readZipText("eurorack-panel.XLN");

  expect(outline).toContain("%TF.FileFunction,Profile,NP*%");
  expect(frontMask).toContain("%TF.FileFunction,Soldermask,Top*%");
  expect(frontMask).toContain("G36*");
  expect(frontMask).not.toContain("%ADD11R");
  expect(frontSilk).toContain("%TF.FileFunction,Legend,Top*%");
  expect(frontSilk).toContain("G36*");
  expect(drill).toMatch(/^METRIC$/m);
  expect(drill).not.toContain("METRIC,TZ");
  expect(drill).toContain("; #@! TF.FileFunction,NonPlated,1,2,NPTH");
  expect(drill).toMatch(/^X\d+\.\d{3}Y\d+\.\d{3}$/m);
});
