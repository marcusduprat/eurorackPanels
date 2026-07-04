import { expect, test } from "@playwright/test";

test("supports undo, redo, and deleting a selected object", async ({ page }) => {
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

  const objectRows = page.locator(".object-row");
  const initialCount = await objectRows.count();

  await page.locator(".object-row").filter({ hasText: "Title" }).click();
  await page.keyboard.press("Control+C");
  await page.keyboard.press("Control+V");
  await expect.poll(() => objectRows.count()).toBe(initialCount + 1);
  await expect(page.locator(".statusbar")).toContainText("Selected: Title copy");
  await page.getByRole("button", { name: "Georgia" }).click();
  await expect(page.getByRole("button", { name: "Georgia" })).toHaveClass(/active/);

  const countAfterPaste = await objectRows.count();
  await page.getByRole("button", { name: "Hole" }).click();
  const canvasBox = await page.locator(".panel-canvas").boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.click(canvasBox!.x + canvasBox!.width * 0.57, canvasBox!.y + canvasBox!.height * 0.54);
  await expect.poll(() => objectRows.count()).toBe(countAfterPaste + 1);
  await expect(page.locator(".statusbar")).toContainText("Selected: Hole");

  const canvasTools = page.locator(".canvas-tools");
  await canvasTools.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => objectRows.count()).toBe(countAfterPaste);

  await canvasTools.getByRole("button", { name: "Redo" }).click();
  await expect.poll(() => objectRows.count()).toBe(countAfterPaste + 1);
  await expect(page.locator(".statusbar")).toContainText("Selected: Hole");
  await page.getByLabel("Preset").selectOption("5");
  await expect(page.getByLabel("Diameter")).toHaveValue("5");

  await page.getByRole("button", { name: "Delete object" }).click();
  await expect.poll(() => objectRows.count()).toBe(countAfterPaste);

  await canvasTools.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => objectRows.count()).toBe(countAfterPaste + 1);

  const zoomBefore = await readZoom(page);
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.5, canvasBox!.y + canvasBox!.height * 0.5);
  await page.mouse.wheel(0, -420);
  await expect.poll(() => readZoom(page)).toBeGreaterThan(zoomBefore);
  const zoomAfterIn = await readZoom(page);
  await page.mouse.wheel(0, 420);
  await expect.poll(() => readZoom(page)).toBeLessThan(zoomAfterIn);

  if (process.env.PLAYWRIGHT_HISTORY_SCREENSHOT) {
    await page.screenshot({ path: process.env.PLAYWRIGHT_HISTORY_SCREENSHOT, fullPage: false });
  }

  expect(consoleProblems).toEqual([]);
});

test("supports grouped Gerber dragging and vector object export controls", async ({ page }) => {
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
  await expect(page.getByText("Panel Objects")).toBeVisible();
  await expect(page.locator(".pcb-area-overlay").first()).toBeVisible();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No test canvas context");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    context.fillRect(5, 3, 14, 10);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("No PNG blob"))), "image/png"));
    const file = new File([blob], "trace-logo.png", { type: "image/png" });
    const input = document.querySelector('input[accept*=".png"]') as HTMLInputElement | null;
    if (!input) throw new Error("No artwork input");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator(".statusbar")).toContainText("Selected: trace-logo");
  await expect(page.getByText(/Vector trace/)).toBeVisible();
  await expect(page.locator(".item-view.artwork path").first()).toBeVisible();
  await page.getByLabel("Trace mode").selectOption("dark");
  await expect(page.getByLabel("Trace mode")).toHaveValue("dark");
  await page.getByLabel("Trace detail").selectOption("96");
  await expect(page.getByLabel("Trace detail")).toHaveValue("96");
  await page.getByLabel("Trace threshold").fill("180");
  await expect(page.getByLabel("Trace threshold")).toHaveValue("180");
  await page.getByRole("button", { name: "Retrace image" }).click();
  await expect(page.getByText(/Vector trace/)).toBeVisible();
  await page.getByLabel("Front silk color").fill("#8844ff");
  await expect(page.getByLabel("Front silk color")).toHaveValue("#8844ff");
  await page.getByRole("button", { name: "Front silk Copper" }).click();
  await expect(page.getByLabel("Front silk color")).toHaveValue("#b87333");
  await page.getByRole("button", { name: "3D preview" }).click();
  await expect(page.getByRole("dialog", { name: "3D preview" })).toBeVisible();
  const previewCanvas = page.locator(".three-preview-canvas");
  await expect(previewCanvas).toBeVisible();
  await expect.poll(() => previewCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL("image/png").length)).toBeGreaterThan(1000);
  const previewBefore = await previewCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL("image/png"));
  await page.getByRole("button", { name: "Iso" }).click();
  await expect(page.getByLabel("Preview angle")).toHaveValue("36");
  await expect.poll(() => previewCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL("image/png"))).not.toBe(previewBefore);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "3D preview" })).toHaveCount(0);
  const cutoutGroup = page.locator(".object-layer-group").filter({ hasText: "Cutouts / none" });
  await expect(cutoutGroup.locator(".object-row")).toHaveCount(4);
  await cutoutGroup.locator(".object-layer-heading").click();
  await expect(cutoutGroup.locator(".object-row")).toHaveCount(0);
  await cutoutGroup.locator(".object-layer-heading").click();
  await expect(cutoutGroup.locator(".object-row")).toHaveCount(4);

  await page.locator(".layer-row").click();
  const offsetX = page.getByLabel("Offset X");
  const beforeOffset = Number(await offsetX.inputValue());
  const canvasBox = await page.locator(".panel-canvas").boundingBox();
  expect(canvasBox).not.toBeNull();
  const dragX = canvasBox!.x + canvasBox!.width * 0.5;
  const dragY = canvasBox!.y + canvasBox!.height * 0.5;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 120, dragY + 30, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await offsetX.inputValue())).not.toBe(beforeOffset);

  const objectRows = page.locator(".object-row");
  const initialCount = await objectRows.count();
  await page.getByLabel("New layer").selectOption("frontCopper");
  await page.getByRole("button", { name: "Draw rectangle" }).click();
  await page.keyboard.down("Shift");
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.42, canvasBox!.y + canvasBox!.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.52, canvasBox!.y + canvasBox!.height * 0.49, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect.poll(() => objectRows.count()).toBe(initialCount + 1);
  await expect(page.locator(".statusbar")).toContainText("Selected: Rectangle");
  const gerberTarget = page.getByLabel("Gerber", { exact: true });
  await expect(gerberTarget).toHaveValue("frontCopper");
  await page.getByLabel("Fill", { exact: true }).check();
  await expect(page.getByLabel("Fill", { exact: true })).toBeChecked();

  const objectPanel = page.locator(".right-panel .panel-block").filter({ hasText: "Object" });
  const objectWidth = objectPanel.getByLabel("Width", { exact: true });
  const widthBefore = Number(await objectWidth.inputValue());
  const resizeHandle = page.locator(".resize-handle").first();
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + 42, resizeBox!.y + 28, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await objectWidth.inputValue())).toBeGreaterThan(widthBefore);

  await gerberTarget.selectOption("backCopper");
  await page.getByLabel("3D height").fill("0.8");
  await expect(gerberTarget).toHaveValue("backCopper");
  await expect(page.getByLabel("3D height")).toHaveValue("0.8");
  await page.getByLabel("3D", { exact: true }).selectOption("cutout");
  await expect(page.getByLabel("3D height")).toBeHidden();
  await page.getByLabel("3D", { exact: true }).selectOption("reveal");
  await expect(gerberTarget).toHaveValue("frontMask");
  await expect(page.getByLabel("3D height")).toBeHidden();
  await page.getByLabel("3D", { exact: true }).selectOption("raised");
  await page.locator(".object-row.selected").dragTo(page.locator(".object-layer-group").filter({ hasText: "Front silk" }));
  await expect(gerberTarget).toHaveValue("frontSilk");

  const countAfterRect = await objectRows.count();
  const pathStartX = canvasBox!.x + canvasBox!.width * 0.36;
  const pathStartY = canvasBox!.y + canvasBox!.height * 0.58;
  await page.getByRole("button", { name: "Draw path" }).click();
  await page.mouse.click(pathStartX, pathStartY);
  await page.mouse.click(pathStartX + 46, pathStartY);
  await page.mouse.click(pathStartX + 46, pathStartY + 38);
  await page.mouse.click(pathStartX + 2, pathStartY + 2);
  await expect.poll(() => objectRows.count()).toBe(countAfterRect + 1);
  await expect(page.locator(".statusbar")).toContainText("Selected: Path");
  if (!(await page.getByLabel("Closed").isChecked())) {
    await page.getByLabel("Closed").check();
  }
  await expect(page.getByLabel("Closed")).toBeChecked();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByLabel("Fill", { exact: true }).check();
  await expect(page.getByLabel("Fill", { exact: true })).toBeChecked();

  const firstPoint = page.locator(".point-handle").first();
  const firstPointBefore = await firstPoint.getAttribute("cx");
  const pointBox = await firstPoint.boundingBox();
  expect(pointBox).not.toBeNull();
  await page.mouse.move(pointBox!.x + pointBox!.width / 2, pointBox!.y + pointBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(pointBox!.x + 34, pointBox!.y + 18, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => firstPoint.getAttribute("cx")).not.toBe(firstPointBefore);

  if (process.env.PLAYWRIGHT_VECTOR_SCREENSHOT) {
    await page.screenshot({ path: process.env.PLAYWRIGHT_VECTOR_SCREENSHOT, fullPage: false });
  }

  expect(consoleProblems).toEqual([]);
});

async function readZoom(page: import("@playwright/test").Page) {
  const text = await page.locator(".statusbar").innerText();
  const match = text.match(/Zoom:\s*([0-9.]+)/);
  return match ? Number(match[1]) : 0;
}
