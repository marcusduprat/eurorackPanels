import { expect, test } from "@playwright/test";

test("imports named SVG layers as separate aligned artwork objects", async ({ page }) => {
  await page.goto("/");

  const objectRows = page.locator(".object-row");
  const initialCount = await objectRows.count();

  await page.evaluate(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg"
        xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
        viewBox="0 0 100 50">
        <defs>
          <style>.panel-fill { fill: #111827; }</style>
        </defs>
        <g inkscape:groupmode="layer" inkscape:label="Panel fill" id="panel-fill">
          <rect class="panel-fill" x="5" y="5" width="90" height="40"/>
        </g>
        <g inkscape:groupmode="layer" inkscape:label="Legends" id="legends">
          <circle cx="50" cy="25" r="10" fill="#f8fafc"/>
        </g>
        <g data-name="Cut lines">
          <path d="M 10 25 H 90" fill="none" stroke="#ef4444"/>
        </g>
      </svg>
    `;
    const file = new File([svg], "module-face.svg", { type: "image/svg+xml" });
    const input = document.querySelector('input[accept*=".svg"]') as HTMLInputElement | null;
    if (!input) throw new Error("No artwork input");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect.poll(() => objectRows.count()).toBe(initialCount + 3);
  await expect(objectRows.filter({ hasText: "module-face / Panel fill" })).toHaveCount(1);
  await expect(objectRows.filter({ hasText: "module-face / Legends" })).toHaveCount(1);
  await expect(objectRows.filter({ hasText: "module-face / Cut lines" })).toHaveCount(1);
  await expect(page.locator(".item-view.artwork image")).toHaveCount(3);
  await expect.poll(() => page.locator(".item-view.artwork path").count()).toBeGreaterThan(0);

  await objectRows.filter({ hasText: "module-face / Panel fill" }).click();
  await expect(page.locator(".statusbar")).toContainText("Selected: module-face / Panel fill");

  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect.poll(() => objectRows.count()).toBe(initialCount);
});
