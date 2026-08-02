import earcut from "earcut";
import type { ArtworkTrace, PanelItem, TraceMode, VectorPoint } from "./types";

const TRACE_MAX_DIMENSION = 128;
const TRACE_THRESHOLD = 154;
const TRACE_ALPHA_THRESHOLD = 32;
const TRACE_MIN_DETAIL = 32;
export const FABRICATION_TRACE_DETAIL = 4096;
export const ARTWORK_TRACE_VERSION = 4;
const FABRICATION_SIMPLIFY_TOLERANCE = 0.5;
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
    version: ARTWORK_TRACE_VERSION,
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    gridWidth,
    gridHeight,
    threshold,
    detail,
    requestedMode,
    mode,
    paths: maskToVectorPaths(mask, gridWidth, gridHeight),
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

function maskToVectorPaths(mask: Uint8Array, width: number, height: number): VectorPoint[][] {
  const simplifyTolerance =
    Math.max(width, height) >= FABRICATION_TRACE_DETAIL
      ? FABRICATION_SIMPLIFY_TOLERANCE
      : Math.max(0.35, Math.min(2, Math.max(width, height) / 1024));
  const contours = boundaryContours(mask, width, height)
    .map((points) => simplifyClosedPath(points, simplifyTolerance))
    .filter((points) => points.length >= 3);
  const outerContours = contours.filter((points) => polygonArea(points) > 0);
  const holeContours = contours.filter((points) => polygonArea(points) < 0);

  // A malformed or edge-touching contour should still export instead of disappearing.
  if (!outerContours.length) {
    outerContours.push(...holeContours.splice(0).map((points) => [...points].reverse()));
  }

  const holesByOuter = new Map<VectorPoint[], VectorPoint[][]>(outerContours.map((outer) => [outer, []]));
  for (const hole of holeContours) {
    const owner = outerContours
      .filter((outer) => pointInPolygon(hole[0], outer))
      .sort((a, b) => Math.abs(polygonArea(a)) - Math.abs(polygonArea(b)))[0];
    if (owner) holesByOuter.get(owner)?.push(hole);
  }

  const paths: VectorPoint[][] = [];
  for (const outer of outerContours) {
    const holes = holesByOuter.get(outer) ?? [];
    if (!holes.length) {
      paths.push(outer.map((point) => ({ x: point.x / width - 0.5, y: point.y / height - 0.5 })));
      continue;
    }
    const loops = [outer, ...holes];
    const flat: number[] = [];
    const holeIndices: number[] = [];
    loops.forEach((loop, loopIndex) => {
      if (loopIndex > 0) holeIndices.push(flat.length / 2);
      loop.forEach((point) => flat.push(point.x, point.y));
    });
    const indices = earcut(flat, holeIndices, 2);
    for (let index = 0; index < indices.length; index += 3) {
      const triangle = [indices[index], indices[index + 1], indices[index + 2]].map((pointIndex) => ({
        x: flat[pointIndex * 2] / width - 0.5,
        y: flat[pointIndex * 2 + 1] / height - 0.5,
      }));
      if (Math.abs(polygonArea(triangle)) > 1e-12) paths.push(triangle);
    }
  }

  return paths;
}

function boundaryContours(mask: Uint8Array, width: number, height: number): VectorPoint[][] {
  const vertexStride = width + 1;
  const outgoing = new Map<number, number[]>();
  const vertexId = (x: number, y: number) => y * vertexStride + x;
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const start = vertexId(x1, y1);
    const end = vertexId(x2, y2);
    outgoing.set(start, [...(outgoing.get(start) ?? []), end]);
  };
  const filled = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] !== 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const decode = (id: number): VectorPoint => ({ x: id % vertexStride, y: Math.floor(id / vertexStride) });
  const edgeKey = (start: number, end: number) => `${start}:${end}`;
  const used = new Set<string>();
  const contours: VectorPoint[][] = [];

  for (const [start, ends] of outgoing) {
    for (const firstEnd of ends) {
      if (used.has(edgeKey(start, firstEnd))) continue;
      const points = [decode(start)];
      let previous = start;
      let current = firstEnd;
      used.add(edgeKey(previous, current));

      for (let guard = 0; current !== start && guard <= outgoing.size * 2; guard += 1) {
        points.push(decode(current));
        const candidates = (outgoing.get(current) ?? []).filter((candidate) => !used.has(edgeKey(current, candidate)));
        if (!candidates.length) break;
        const next = chooseBoundaryEdge(previous, current, candidates, decode);
        used.add(edgeKey(current, next));
        previous = current;
        current = next;
      }

      if (current === start && points.length >= 3) contours.push(points);
    }
  }

  return contours;
}

function chooseBoundaryEdge(previous: number, current: number, candidates: number[], decode: (id: number) => VectorPoint) {
  if (candidates.length === 1) return candidates[0];
  const from = decode(previous);
  const at = decode(current);
  const incoming = { x: at.x - from.x, y: at.y - from.y };
  return [...candidates].sort((a, b) => boundaryTurnScore(incoming, at, decode(b)) - boundaryTurnScore(incoming, at, decode(a)))[0];
}

function boundaryTurnScore(incoming: VectorPoint, at: VectorPoint, next: VectorPoint) {
  const outgoing = { x: next.x - at.x, y: next.y - at.y };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  return Math.atan2(cross, dot);
}

function simplifyClosedPath(points: VectorPoint[], tolerance: number) {
  const compact = points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return (point.x - previous.x) * (next.y - point.y) !== (point.y - previous.y) * (next.x - point.x);
  });
  if (compact.length <= 3) return compact;

  let split = 1;
  let farthest = 0;
  for (let index = 1; index < compact.length; index += 1) {
    const distance = squaredDistance(compact[0], compact[index]);
    if (distance > farthest) {
      farthest = distance;
      split = index;
    }
  }

  const first = simplifyOpenPath(compact.slice(0, split + 1), tolerance);
  const second = simplifyOpenPath([...compact.slice(split), compact[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function simplifyOpenPath(points: VectorPoint[], tolerance: number): VectorPoint[] {
  if (points.length <= 2) return points;
  let farthestIndex = 0;
  let farthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointSegmentDistance(points[index], points[0], points.at(-1) ?? points[0]);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestDistance <= tolerance) return [points[0], points.at(-1) ?? points[0]];
  const left = simplifyOpenPath(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplifyOpenPath(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function pointSegmentDistance(point: VectorPoint, start: VectorPoint, end: VectorPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.sqrt(squaredDistance(point, start));
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function squaredDistance(a: VectorPoint, b: VectorPoint) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function polygonArea(points: VectorPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInPolygon(point: VectorPoint, polygon: VectorPoint[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
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
