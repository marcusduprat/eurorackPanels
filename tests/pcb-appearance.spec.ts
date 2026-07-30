import { expect, test } from "@playwright/test";

test("selects a whole-board PCB colour and renders copper above silk", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "PCB colour Green" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PCB colour Purple" })).toBeVisible();
  await page.getByLabel("PCB colour", { exact: true }).fill("#6d2e8a");
  await expect(page.locator(".panel-board-surface")).toHaveAttribute("fill", "#6d2e8a");

  await page.evaluate(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
        <g data-name="Copper">
          <rect x="15" y="10" width="70" height="30" fill="#111827"/>
        </g>
        <g data-name="Silk">
          <circle cx="50" cy="25" r="18" fill="#111827"/>
        </g>
      </svg>
    `;
    const file = new File([svg], "stack.svg", { type: "image/svg+xml" });
    const input = document.querySelector('input[accept*=".svg"]') as HTMLInputElement | null;
    if (!input) throw new Error("No artwork input");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const copperRow = page.locator(".object-row").filter({ hasText: "stack / Copper" });
  await expect(copperRow).toBeVisible();
  await copperRow.click();
  await page.getByLabel("Gerber", { exact: true }).selectOption("frontCopper");

  const visualLayers = await page.locator(".panel-items > g[data-gerber-layer]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-gerber-layer")),
  );
  const lastSilk = visualLayers.lastIndexOf("frontSilk");
  const firstCopper = visualLayers.indexOf("frontCopper");
  expect(lastSilk).toBeGreaterThanOrEqual(0);
  expect(firstCopper).toBeGreaterThan(lastSilk);

  const exportedProject = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const projectDownload = await exportedProject;
  const projectPath = await projectDownload.path();
  if (!projectPath) throw new Error("No path for project export");
  const projectJson = await (await import("node:fs/promises")).readFile(projectPath, "utf8");
  expect(projectJson).toContain('"pcbColor": "#6d2e8a"');
  expect(projectJson).toContain('"detail": 4096');
});

test("places back artwork below the board and makes manufacturing fills opaque", async ({ page }) => {
  await page.goto("/");

  const placements = await page.evaluate(async () => {
    const app = await import("/src/App.tsx");
    return {
      frontSilk: app.pcbThreeLayerPlacement("frontSilk", 2),
      frontCopper: app.pcbThreeLayerPlacement("frontCopper", 2),
      backSilk: app.pcbThreeLayerPlacement("backSilk", 2),
      backCopper: app.pcbThreeLayerPlacement("backCopper", 2),
    };
  });
  expect(placements.frontSilk.outwardNormal).toBe(1);
  expect(placements.frontCopper.zSurface).toBeGreaterThan(placements.frontSilk.zSurface);
  expect(placements.frontSilk.zSurface).toBeGreaterThan(2);
  expect(placements.backSilk.outwardNormal).toBe(-1);
  expect(placements.backCopper.zSurface).toBeLessThan(placements.backSilk.zSurface);
  expect(placements.backSilk.zSurface).toBeLessThan(0);

  await page.evaluate(() => {
    const project = {
      settings: {
        hp: 12,
        widthMm: 60.96,
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
      items: [
        {
          id: "silk-circle",
          kind: "vector-circle",
          label: "Silk circle",
          x: 30,
          y: 40,
          diameter: 20,
          filled: true,
          gerberLayer: "frontSilk",
          stlMode: "raised",
        },
        {
          id: "copper-circle",
          kind: "vector-circle",
          label: "Copper circle",
          x: 30,
          y: 40,
          diameter: 10,
          filled: true,
          gerberLayer: "frontCopper",
          stlMode: "raised",
        },
      ],
      layers: [],
    };
    const input = document.querySelector('input[accept=".json"]') as HTMLInputElement | null;
    if (!input) throw new Error("No project input");
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(project)], "layer-project.json", { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.locator('[data-gerber-layer="frontSilk"] .item-view.vector circle').first()).toHaveAttribute("fill-opacity", "1");
  await expect(page.locator('[data-gerber-layer="frontCopper"] .item-view.vector circle').first()).toHaveAttribute("fill-opacity", "1");
});

test("upgrades saved SVG artwork from the legacy trace algorithm", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M 5 5 H 95 V 45 H 5 Z" fill="#111827"/></svg>`;
    const imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const project = {
      settings: {
        hp: 12,
        widthMm: 60.96,
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
      items: [
        {
          id: "legacy-svg",
          kind: "artwork",
          label: "Legacy SVG",
          x: 30.48,
          y: 64.25,
          width: 40,
          height: 20,
          imageUrl,
          filled: true,
          gerberLayer: "frontSilk",
          stlMode: "raised",
          artworkTrace: {
            sourceWidth: 100,
            sourceHeight: 50,
            gridWidth: 100,
            gridHeight: 50,
            threshold: 154,
            detail: 4096,
            mode: "alpha",
            paths: [[
              { x: -0.45, y: -0.4 },
              { x: 0.45, y: -0.4 },
              { x: 0.45, y: 0.4 },
              { x: -0.45, y: 0.4 },
            ]],
          },
        },
      ],
      layers: [],
    };
    const input = document.querySelector('input[accept=".json"]') as HTMLInputElement | null;
    if (!input) throw new Error("No project input");
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(project)], "legacy-project.json", { type: "application/json" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.locator(".object-row").filter({ hasText: "Legacy SVG" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("No upgraded project download");
  const saved = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
  expect(saved.items[0].artworkTrace.detail).toBe(4096);
  expect(saved.items[0].artworkTrace.version).toBe(3);
});
