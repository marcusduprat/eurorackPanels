import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

test("exports fabrication-ready SVG silk, PCB reveal, and drill files", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const project = {
      settings: {
        hp: 18,
        widthMm: 91.44,
        heightMm: 128.5,
        thicknessMm: 2,
        mountHoleDiameter: 3.2,
        mountHoleInsetX: 7.5,
        mountHoleInsetY: 3,
        showMountingHoles: true,
        showPcbArea: true,
        pcbInsetX: 5,
        pcbInsetY: 8,
        gridMm: 2.54,
      },
      items: [],
      layers: [],
    };
    const input = document.querySelector('input[accept=".json"]') as HTMLInputElement | null;
    if (!input) throw new Error("No project input");
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(project)], "blank-project.json", { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator(".object-row")).toHaveCount(0);
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
  const backMask = await readZipText("eurorack-panel.GBS");
  const frontSilk = await readZipText("eurorack-panel.GTO");
  const drill = await readZipText("eurorack-panel.XLN");

  expect(outline).toContain("%TF.FileFunction,Profile,NP*%");
  expect(frontMask).toContain("%TF.FileFunction,Soldermask,Top*%");
  expect(frontMask).toContain("G36*");
  expect(frontMask).not.toContain("%ADD11R");
  expect(backMask).toContain("%TF.FileFunction,Soldermask,Bot*%");
  expect(backMask).toContain("G36*");
  expect(frontSilk).toContain("%TF.FileFunction,Legend,Top*%");
  expect(frontSilk).toContain("G36*");
  expect(frontSilk.match(/G36\*/g)?.length ?? 0).toBeLessThan(20);
  expect(drill).toMatch(/^METRIC$/m);
  expect(drill).not.toContain("METRIC,TZ");
  expect(drill).toContain("; #@! TF.FileFunction,NonPlated,1,2,NPTH");
  expect(drill).toMatch(/^G00X\d+\.\d{3}Y\d+\.\d{3}$/m);
  expect(drill).toContain("M15");
  expect(drill).toContain("M16");
});

test("preserves transparent holes while converting SVG artwork to smooth regions", async ({ page }) => {
  await page.goto("/");
  const trace = await page.evaluate(async () => {
    const { traceImageToArtwork } = await import("/src/artworkTrace.ts");
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path fill="#111827" fill-rule="evenodd" d="M 5 5 H 95 V 95 H 5 Z M 30 30 H 70 V 70 H 30 Z"/>
      </svg>
    `;
    const result = await traceImageToArtwork(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, {
      mode: "alpha",
      detail: 512,
      allowUpscale: true,
    });
    const area = result.paths.reduce((total, path) => {
      let signed = 0;
      for (let index = 0; index < path.length; index += 1) {
        const current = path[index];
        const next = path[(index + 1) % path.length];
        signed += current.x * next.y - next.x * current.y;
      }
      return total + Math.abs(signed / 2);
    }, 0);
    return { area, pathCount: result.paths.length, version: result.version };
  });

  expect(trace.area).toBeGreaterThan(0.62);
  expect(trace.area).toBeLessThan(0.68);
  expect(trace.pathCount).toBeLessThan(20);
  expect(trace.version).toBe(4);
});

test("retains fine curved contours at fabrication trace detail", async ({ page }) => {
  await page.goto("/");
  const trace = await page.evaluate(async () => {
    const { FABRICATION_TRACE_DETAIL, traceImageToArtwork } = await import("/src/artworkTrace.ts");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="8" fill="#111827"/></svg>`;
    return traceImageToArtwork(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, {
      mode: "alpha",
      detail: FABRICATION_TRACE_DETAIL,
      allowUpscale: true,
    });
  });

  expect(trace.gridWidth).toBe(4096);
  expect(trace.paths).toHaveLength(1);
  expect(trace.paths[0].length).toBeGreaterThanOrEqual(48);
});
