import type { ArtworkTrace, PanelItem, TraceMode, VectorPoint } from "./types";

const TRACE_MAX_DIMENSION = 128;
const TRACE_THRESHOLD = 154;
const TRACE_ALPHA_THRESHOLD = 32;
const TRACE_MIN_DETAIL = 32;
export const FABRICATION_TRACE_DETAIL = 2048;
const TRACE_MAX_DETAIL = FABRICATION_TRACE_DETAIL;

export type TraceImageOptions = {
  mode?: TraceMode;
  threshold?: number;
  detail?: number;
  allowUpscale?: boolean;
};

export async function traceImageToArtwork(dataUrl: string, options: TraceImageOptions = {}): Promise<ArtworkTrace> {
  const image = await loadImage(dataUrl);
  const detail = clamp(Math.round(options.detail ?? TRACE_MAX_DIMENSION), TRACE_MIN_DETAIL, TRACE_MAX_DETAIL);
  const threshold = clamp(Math.round(options.threshold ?? TRACE_THRESHOLD), 0, 255);
  const requestedMode = options.mode ?? "auto";
  const requestedScale = detail / Math.max(image.naturalWidth, image.naturalHeight);
  const scale = options.allowUpscale ? requestedScale : Math.min(1, requestedScale);
  const gridWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const gridHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = gridWidth;
  canvas.height = gridHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not prepare image trace");

  context.clearRect(0, 0, gridWidth, gridHeight);
  context.drawImage(image, 0, 0, gridWidth, gridHeight);
  const pixels = context.getImageData(0, 0, gridWidth, gridHeight).data;
  const total = gridWidth * gridHeight;
  let opaque = 0;
  let dark = 0;
  const lumas = new Uint8Array(total);
  const alphas = new Uint8Array(total);

  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    const alpha = pixels[offset + 3];
    const luma = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    alphas[index] = alpha;
    lumas[index] = luma;
    if (alpha > 24) opaque += 1;
    if (alpha > 24 && luma < threshold) dark += 1;
  }

  const transparentRatio = 1 - opaque / total;
  const darkRatio = opaque ? dark / opaque : 0;
  const autoMode: ArtworkTrace["mode"] = transparentRatio > 0.08 ? "alpha" : darkRatio > 0.62 ? "inverted-luma" : "luma";
  const mode = resolveMode(requestedMode, autoMode);
  const mask = new Uint8Array(total);

  for (let index = 0; index < total; index += 1) {
    if (mode === "alpha") {
      mask[index] = alphas[index] > TRACE_ALPHA_THRESHOLD ? 1 : 0;
    } else if (mode === "inverted-luma") {
      mask[index] = alphas[index] > 24 && lumas[index] > threshold ? 1 : 0;
    } else {
      mask[index] = alphas[index] > 24 && lumas[index] < threshold ? 1 : 0;
    }
  }

  return {
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    gridWidth,
    gridHeight,
    threshold,
    detail,
    requestedMode,
    mode,
    paths: runsToVectorPaths(mask, gridWidth, gridHeight),
  };
}

export function hasArtworkTrace(item: PanelItem): item is PanelItem & { artworkTrace: ArtworkTrace } {
  return item.kind === "artwork" && Boolean(item.artworkTrace?.paths.length);
}

export function artworkTracePathsForItem(item: PanelItem): VectorPoint[][] {
  if (!hasArtworkTrace(item)) return [];
  const width = item.width ?? 20;
  const height = item.height ?? width;
  const radians = ((item.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return item.artworkTrace.paths.map((path) =>
    path.map((point) => {
      const localX = point.x * width;
      const localY = point.y * height;
      return {
        x: item.x + localX * cos - localY * sin,
        y: item.y + localX * sin + localY * cos,
      };
    }),
  );
}

function runsToVectorPaths(mask: Uint8Array, width: number, height: number): VectorPoint[][] {
  const paths: VectorPoint[][] = [];
  let active = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();

  for (let y = 0; y < height; y += 1) {
    const seen = new Set<string>();
    for (const run of rowRuns(mask, width, y)) {
      const key = `${run.x0}:${run.x1}`;
      const current = active.get(key);
      if (current) {
        current.y1 = y + 1;
      } else {
        active.set(key, { x0: run.x0, x1: run.x1, y0: y, y1: y + 1 });
      }
      seen.add(key);
    }

    for (const [key, rect] of active) {
      if (!seen.has(key)) {
        paths.push(rectToPath(rect, width, height));
        active.delete(key);
      }
    }
  }

  for (const rect of active.values()) {
    paths.push(rectToPath(rect, width, height));
  }

  return paths;
}

function rowRuns(mask: Uint8Array, width: number, y: number) {
  const runs: Array<{ x0: number; x1: number }> = [];
  let x = 0;
  while (x < width) {
    while (x < width && !mask[y * width + x]) x += 1;
    const x0 = x;
    while (x < width && mask[y * width + x]) x += 1;
    if (x > x0) runs.push({ x0, x1: x });
  }
  return runs;
}

function rectToPath(rect: { x0: number; x1: number; y0: number; y1: number }, width: number, height: number): VectorPoint[] {
  const x0 = rect.x0 / width - 0.5;
  const x1 = rect.x1 / width - 0.5;
  const y0 = rect.y0 / height - 0.5;
  const y1 = rect.y1 / height - 0.5;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function resolveMode(mode: TraceMode, autoMode: ArtworkTrace["mode"]): ArtworkTrace["mode"] {
  if (mode === "dark") return "luma";
  if (mode === "light") return "inverted-luma";
  if (mode === "alpha") return "alpha";
  return autoMode;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image for tracing"));
    image.src = dataUrl;
  });
}
