import { expect, test } from "@playwright/test";

test("tints, locks, and hides overlapping SVG artwork objects", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
        <g data-name="Bottom artwork">
          <rect x="5" y="5" width="90" height="40" fill="#111827"/>
        </g>
        <g data-name="Top artwork">
          <circle cx="50" cy="25" r="18" fill="#f8fafc"/>
        </g>
      </svg>
    `;
    const file = new File([svg], "overlap.svg", { type: "image/svg+xml" });
    const input = document.querySelector('input[accept*=".svg"]') as HTMLInputElement | null;
    if (!input) throw new Error("No artwork input");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const artworkViews = page.locator(".item-view.artwork");
  const bottomRow = page.locator(".object-row").filter({ hasText: "overlap / Bottom artwork" });
  const topRow = page.locator(".object-row").filter({ hasText: "overlap / Top artwork" });
  await expect(artworkViews).toHaveCount(2);

  await page.getByLabel("Front silk color").fill("#ff00aa");
  await expect(artworkViews.locator("feFlood")).toHaveCount(2);
  await expect.poll(() => artworkViews.locator("feFlood").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("flood-color")))).toEqual(["#ff00aa", "#ff00aa"]);

  await topRow.getByRole("button", { name: "Lock overlap / Top artwork" }).click();
  await expect(topRow.getByRole("button", { name: "Unlock overlap / Top artwork" })).toBeVisible();
  const overlapBounds = await artworkViews.last().boundingBox();
  expect(overlapBounds).not.toBeNull();
  await page.mouse.click(overlapBounds!.x + overlapBounds!.width / 2, overlapBounds!.y + overlapBounds!.height / 2);
  await expect(page.locator(".statusbar")).toContainText("Selected: overlap / Bottom artwork");

  await bottomRow.getByRole("button", { name: "Hide overlap / Bottom artwork" }).click();
  await expect(artworkViews).toHaveCount(1);
  await expect(bottomRow.getByRole("button", { name: "Show overlap / Bottom artwork" })).toBeVisible();

  await bottomRow.getByRole("button", { name: "Show overlap / Bottom artwork" }).click();
  await expect(artworkViews).toHaveCount(2);

  if (process.env.PLAYWRIGHT_LAYER_CONTROLS_SCREENSHOT) {
    await page.screenshot({ path: process.env.PLAYWRIGHT_LAYER_CONTROLS_SCREENSHOT, fullPage: false });
  }
});
