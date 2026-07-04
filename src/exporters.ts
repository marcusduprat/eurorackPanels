import earcut from "earcut";
import { artworkTracePathsForItem, hasArtworkTrace } from "./artworkTrace";
import type { GerberTargetLayer, PanelItem, PanelSettings } from "./types";

type Hole = {
  x: number;
  y: number;
  diameter: number;
  label: string;
};

type Point3 = [number, number, number];
type Point2 = [number, number];
type GerberGraphicLayer = Exclude<GerberTargetLayer, "none">;

const MM_TO_GERBER = 1_000_000;
const DEFAULT_GRAPHIC_STROKE = 0.22;
const GERBER_FILL_STEP = 0.45;
const STROKE_FONT: Record<string, Array<[number, number, number, number]>> = {
  " ": [],
  "?": [
    [0, 1, 2.5, 0],
    [2.5, 0, 5, 1],
    [5, 1, 5, 3],
    [5, 3, 2.5, 4],
    [2.5, 5.2, 2.5, 5.8],
  ],
  "0": [
    [0, 0, 5, 0],
    [5, 0, 5, 7],
    [5, 7, 0, 7],
    [0, 7, 0, 0],
  ],
  "1": [
    [2.5, 0, 2.5, 7],
    [1.2, 1.2, 2.5, 0],
    [1, 7, 4, 7],
  ],
  "2": [
    [0, 1, 1, 0],
    [1, 0, 5, 0],
    [5, 0, 5, 3],
    [5, 3, 0, 7],
    [0, 7, 5, 7],
  ],
  "3": [
    [0, 0, 5, 0],
    [5, 0, 5, 7],
    [0, 3.5, 5, 3.5],
    [0, 7, 5, 7],
  ],
  "4": [
    [0, 0, 0, 3.5],
    [0, 3.5, 5, 3.5],
    [5, 0, 5, 7],
  ],
  "5": [
    [5, 0, 0, 0],
    [0, 0, 0, 3.5],
    [0, 3.5, 5, 3.5],
    [5, 3.5, 5, 7],
    [5, 7, 0, 7],
  ],
  "6": [
    [5, 0, 0, 3],
    [0, 3, 0, 7],
    [0, 7, 5, 7],
    [5, 7, 5, 3.5],
    [5, 3.5, 0, 3.5],
  ],
  "7": [
    [0, 0, 5, 0],
    [5, 0, 1.5, 7],
  ],
  "8": [
    [0, 0, 5, 0],
    [5, 0, 5, 7],
    [5, 7, 0, 7],
    [0, 7, 0, 0],
    [0, 3.5, 5, 3.5],
  ],
  "9": [
    [5, 4, 0, 4],
    [0, 4, 0, 0],
    [0, 0, 5, 0],
    [5, 0, 5, 7],
    [5, 7, 0, 7],
  ],
  A: [
    [0, 7, 0, 1],
    [0, 1, 2.5, 0],
    [2.5, 0, 5, 1],
    [5, 1, 5, 7],
    [0, 3.5, 5, 3.5],
  ],
  B: [
    [0, 0, 0, 7],
    [0, 0, 4, 0],
    [4, 0, 5, 1],
    [5, 1, 5, 2.7],
    [5, 2.7, 4, 3.5],
    [0, 3.5, 4, 3.5],
    [4, 3.5, 5, 4.3],
    [5, 4.3, 5, 6],
    [5, 6, 4, 7],
    [4, 7, 0, 7],
  ],
  C: [
    [5, 0, 0, 0],
    [0, 0, 0, 7],
    [0, 7, 5, 7],
  ],
  D: [
    [0, 0, 0, 7],
    [0, 0, 4, 0],
    [4, 0, 5, 1],
    [5, 1, 5, 6],
    [5, 6, 4, 7],
    [4, 7, 0, 7],
  ],
  E: [
    [5, 0, 0, 0],
    [0, 0, 0, 7],
    [0, 3.5, 4, 3.5],
    [0, 7, 5, 7],
  ],
  F: [
    [0, 0, 0, 7],
    [0, 0, 5, 0],
    [0, 3.5, 4, 3.5],
  ],
  G: [
    [5, 0, 0, 0],
    [0, 0, 0, 7],
    [0, 7, 5, 7],
    [5, 7, 5, 4],
    [5, 4, 2.8, 4],
  ],
  H: [
    [0, 0, 0, 7],
    [5, 0, 5, 7],
    [0, 3.5, 5, 3.5],
  ],
  I: [
    [0, 0, 5, 0],
    [2.5, 0, 2.5, 7],
    [0, 7, 5, 7],
  ],
  J: [
    [0, 0, 5, 0],
    [5, 0, 5, 6],
    [5, 6, 4, 7],
    [4, 7, 1, 7],
    [1, 7, 0, 6],
  ],
  K: [
    [0, 0, 0, 7],
    [5, 0, 0, 3.8],
    [0, 3.8, 5, 7],
  ],
  L: [
    [0, 0, 0, 7],
    [0, 7, 5, 7],
  ],
  M: [
    [0, 7, 0, 0],
    [0, 0, 2.5, 3.5],
    [2.5, 3.5, 5, 0],
    [5, 0, 5, 7],
  ],
  N: [
    [0, 7, 0, 0],
    [0, 0, 5, 7],
    [5, 7, 5, 0],
  ],
  O: [
    [0, 0, 5, 0],
    [5, 0, 5, 7],
    [5, 7, 0, 7],
    [0, 7, 0, 0],
  ],
  P: [
    [0, 7, 0, 0],
    [0, 0, 5, 0],
    [5, 0, 5, 3.5],
    [5, 3.5, 0, 3.5],
  ],
  Q: [
    [0, 0, 5, 0],
    [5, 0, 5, 7],
    [5, 7, 0, 7],
    [0, 7, 0, 0],
    [3, 5, 5, 7],
  ],
  R: [
    [0, 7, 0, 0],
    [0, 0, 5, 0],
    [5, 0, 5, 3.5],
    [5, 3.5, 0, 3.5],
    [0, 3.5, 5, 7],
  ],
  S: [
    [5, 0, 0, 0],
    [0, 0, 0, 3.5],
    [0, 3.5, 5, 3.5],
    [5, 3.5, 5, 7],
    [5, 7, 0, 7],
  ],
  T: [
    [0, 0, 5, 0],
    [2.5, 0, 2.5, 7],
  ],
  U: [
    [0, 0, 0, 6],
    [0, 6, 1, 7],
    [1, 7, 4, 7],
    [4, 7, 5, 6],
    [5, 6, 5, 0],
  ],
  V: [
    [0, 0, 2.5, 7],
    [2.5, 7, 5, 0],
  ],
  W: [
    [0, 0, 1, 7],
    [1, 7, 2.5, 4],
    [2.5, 4, 4, 7],
    [4, 7, 5, 0],
  ],
  X: [
    [0, 0, 5, 7],
    [5, 0, 0, 7],
  ],
  Y: [
    [0, 0, 2.5, 3.5],
    [5, 0, 2.5, 3.5],
    [2.5, 3.5, 2.5, 7],
  ],
  Z: [
    [0, 0, 5, 0],
    [5, 0, 0, 7],
    [0, 7, 5, 7],
  ],
  "-": [[0, 3.5, 5, 3.5]],
  ".": [[2.4, 6.7, 2.6, 7]],
  "/": [[0, 7, 5, 0]],
};

export function downloadText(fileName: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  downloadBlob(fileName, blob);
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function panelHoles(settings: PanelSettings, items: PanelItem[]): Hole[] {
  const holes = items
    .filter((item) => (item.kind === "pot" || item.kind === "jack" || item.kind === "hole") && item.diameter)
    .map((item) => ({
      x: item.x,
      y: item.y,
      diameter: item.diameter ?? 3.2,
      label: item.label,
    }));

  if (settings.showMountingHoles) {
    const x1 = settings.mountHoleInsetX;
    const x2 = settings.widthMm - settings.mountHoleInsetX;
    const y1 = settings.mountHoleInsetY;
    const y2 = settings.heightMm - settings.mountHoleInsetY;
    holes.push(
      { x: x1, y: y1, diameter: settings.mountHoleDiameter, label: "Mount TL" },
      { x: x2, y: y1, diameter: settings.mountHoleDiameter, label: "Mount TR" },
      { x: x1, y: y2, diameter: settings.mountHoleDiameter, label: "Mount BL" },
      { x: x2, y: y2, diameter: settings.mountHoleDiameter, label: "Mount BR" },
    );
  }

  return holes.filter(
    (hole) =>
      hole.x > 0 &&
      hole.y > 0 &&
      hole.x < settings.widthMm &&
      hole.y < settings.heightMm &&
      hole.diameter > 0,
  );
}

export function createSvg(settings: PanelSettings, items: PanelItem[]) {
  const holes = panelHoles(settings, items);
  const artwork = items
    .filter((item) => item.kind === "artwork" && item.imageUrl && !hasArtworkTrace(item))
    .map((item) => {
      const width = item.width ?? 20;
      const height = item.height ?? 20;
      const rotate = item.rotation ?? 0;
      return `<image href="${escapeXml(item.imageUrl ?? "")}" x="${round(item.x - width / 2)}" y="${round(
        item.y - height / 2,
      )}" width="${round(width)}" height="${round(height)}" opacity="${item.opacity ?? 1}" transform="rotate(${round(
        rotate,
      )} ${round(item.x)} ${round(item.y)})" />`;
    })
    .join("\n  ");

  const labels = items
    .filter((item) => item.kind === "text" && item.text)
    .map(
      (item) =>
        `<text x="${round(item.x)}" y="${round(item.y)}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(
          item.fontFamily ?? "Inter, Arial, sans-serif",
        )}" font-size="${round(
          item.fontSize ?? 4,
        )}" font-weight="${item.fontWeight ?? 720}" font-style="${item.fontStyle ?? "normal"}" transform="rotate(${round(item.rotation ?? 0)} ${round(item.x)} ${round(item.y)})">${escapeXml(
          item.text ?? "",
        )}</text>`,
    )
    .join("\n  ");

  const vectors = items.map(svgForVectorItem).filter(Boolean).join("\n  ");

  const holeTags = holes
    .map(
      (hole) =>
        `<circle cx="${round(hole.x)}" cy="${round(hole.y)}" r="${round(hole.diameter / 2)}" fill="none" stroke="#111827" stroke-width="0.18" />`,
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(settings.widthMm)}mm" height="${round(
    settings.heightMm,
  )}mm" viewBox="0 0 ${round(settings.widthMm)} ${round(settings.heightMm)}">
  <rect x="0" y="0" width="${round(settings.widthMm)}" height="${round(settings.heightMm)}" rx="1.5" fill="white" stroke="#111827" stroke-width="0.22" />
  ${artwork}
  ${labels}
  ${vectors}
  ${holeTags}
</svg>
`;
}

export function createDxf(settings: PanelSettings, items: PanelItem[]) {
  const holes = panelHoles(settings, items);
  const entities: string[] = [];
  addDxfLine(entities, 0, 0, settings.widthMm, 0);
  addDxfLine(entities, settings.widthMm, 0, settings.widthMm, settings.heightMm);
  addDxfLine(entities, settings.widthMm, settings.heightMm, 0, settings.heightMm);
  addDxfLine(entities, 0, settings.heightMm, 0, 0);
  for (const hole of holes) {
    addDxfCircle(entities, hole.x, hole.y, hole.diameter / 2);
  }
  for (const item of items.filter((entry) => entry.kind === "text" && entry.text)) {
    addDxfText(entities, item.x, item.y, item.fontSize ?? 4, item.rotation ?? 0, item.text ?? "");
  }
  for (const item of items) {
    addDxfVectorItem(entities, item);
  }

  return `0
SECTION
2
ENTITIES
${entities.join("")}0
ENDSEC
0
EOF
`;
}

export function createGerberOutline(settings: PanelSettings) {
  const w = settings.widthMm;
  const h = settings.heightMm;
  return `%FSLAX46Y46*%
%MOMM*%
%LPD*%
%ADD10C,0.100000*%
D10*
G01*
X${g(0)}Y${g(0)}D02*
X${g(w)}Y${g(0)}D01*
X${g(w)}Y${g(h)}D01*
X${g(0)}Y${g(h)}D01*
X${g(0)}Y${g(0)}D01*
M02*
`;
}

export function createGerberGraphicLayer(settings: PanelSettings, items: PanelItem[], layer: GerberGraphicLayer) {
  const segments = items.flatMap((item) => {
    const target = item.gerberLayer ?? defaultGerberLayer(item);
    return target === layer ? gerberSegmentsForItem(item) : [];
  });
  const clearSegments = items.flatMap((item) => (revealClearsLayer(item, layer) ? gerberSegmentsForItem(item) : []));
  const isBaseLayer = layer === "frontMask" || layer === "backMask";
  const body = gerberSegmentBody(segments, settings);
  const clearBody = gerberSegmentBody(clearSegments, settings);

  return `%FSLAX46Y46*%
%MOMM*%
%LPD*%
%ADD10C,${DEFAULT_GRAPHIC_STROKE.toFixed(6)}*%
${isBaseLayer ? `%ADD11R,${settings.widthMm.toFixed(6)}X${settings.heightMm.toFixed(6)}*%` : ""}
${isBaseLayer ? `D11*
X${g(settings.widthMm / 2)}Y${g(settings.heightMm / 2)}D03*` : ""}
D10*
G01*
${body}
${clearBody ? `%LPC*%
D10*
G01*
${clearBody}
%LPD*%` : ""}
M02*
`;
}

function gerberSegmentBody(segments: Array<[Point2, Point2]>, settings: PanelSettings) {
  return segments
    .map(
      ([start, end]) => `X${g(clampMm(start[0], settings.widthMm))}Y${g(clampMm(start[1], settings.heightMm))}D02*
X${g(clampMm(end[0], settings.widthMm))}Y${g(clampMm(end[1], settings.heightMm))}D01*`,
    )
    .join("\n");
}

function revealClearsLayer(item: PanelItem, layer: GerberGraphicLayer) {
  if (item.stlMode !== "reveal") return false;
  const baseLayer = revealBaseLayer(item.gerberLayer ?? defaultGerberLayer(item));
  if (baseLayer === "frontMask") return layer === "frontCopper" || layer === "frontSilk";
  return layer === "backCopper" || layer === "backSilk";
}

function revealBaseLayer(layer: GerberTargetLayer): "frontMask" | "backMask" {
  return layer === "backMask" || layer === "backCopper" || layer === "backSilk" ? "backMask" : "frontMask";
}
export function createDrill(settings: PanelSettings, items: PanelItem[]) {
  const holes = panelHoles(settings, items);
  const groups = new Map<string, Hole[]>();
  for (const hole of holes) {
    const key = hole.diameter.toFixed(3);
    groups.set(key, [...(groups.get(key) ?? []), hole]);
  }

  const sizes = [...groups.keys()].sort((a, b) => Number(a) - Number(b));
  const header = ["M48", "METRIC,TZ"];
  sizes.forEach((size, index) => {
    header.push(`T${String(index + 1).padStart(2, "0")}C${size}`);
  });
  header.push("%");

  const body: string[] = [];
  sizes.forEach((size, index) => {
    body.push(`T${String(index + 1).padStart(2, "0")}`);
    for (const hole of groups.get(size) ?? []) {
      body.push(`X${drill(hole.x)}Y${drill(hole.y)}`);
    }
  });

  return `${header.join("\n")}\n${body.join("\n")}\nM30\n`;
}

export function createStl(settings: PanelSettings, items: PanelItem[]) {
  const holes = panelHoles(settings, items);
  const zTop = settings.thicknessMm / 2;
  const zBottom = -settings.thicknessMm / 2;
  const outer: Point2[] = [
    [0, 0],
    [settings.widthMm, 0],
    [settings.widthMm, settings.heightMm],
    [0, settings.heightMm],
  ];
  const holeLoops: Point2[][] = [
    ...holes.map((hole) => circleLoop2(hole.x, hole.y, hole.diameter / 2, 48).reverse()),
    ...items.flatMap((item) => stlCutoutLoopsForItem(item, settings)),
  ];
  const flat: number[] = [];
  const holeIndices: number[] = [];

  for (const point of outer) flat.push(point[0], point[1]);
  for (const loop of holeLoops) {
    holeIndices.push(flat.length / 2);
    for (const point of loop) flat.push(point[0], point[1]);
  }

  const triangles = earcut(flat, holeIndices);
  const facets: string[] = ["solid eurorack_panel"];

  for (let index = 0; index < triangles.length; index += 3) {
    const a = pointAt(flat, triangles[index], zTop);
    const b = pointAt(flat, triangles[index + 1], zTop);
    const c = pointAt(flat, triangles[index + 2], zTop);
    addFacet(facets, a, b, c);
    addFacet(facets, [a[0], a[1], zBottom], [c[0], c[1], zBottom], [b[0], b[1], zBottom]);
  }

  addWall(facets, outer, zBottom, zTop, false);
  for (const loop of holeLoops) {
    addWall(facets, loop, zBottom, zTop, true);
  }

  for (const item of items.filter((entry) => (entry.stlMode ?? "raised") === "raised")) {
    addReliefForItem(facets, item, zTop, holeLoops);
  }

  facets.push("endsolid eurorack_panel");
  return facets.join("\n");
}

function stlCutoutLoopsForItem(item: PanelItem, settings: PanelSettings): Point2[][] {
  if (item.stlMode !== "cutout") return [];

  const loops: Point2[][] = [];
  const stroke = Math.max(item.strokeWidth ?? DEFAULT_GRAPHIC_STROKE, 0.1);

  if (item.kind === "artwork" && hasArtworkTrace(item)) {
    loops.push(...artworkTraceLoops(item));
  } else if (item.kind === "text" || item.kind === "artwork" || item.kind === "vector-rect") {
    loops.push(rectLoop(item));
  } else if (item.kind === "vector-circle") {
    loops.push(circleLoop2(item.x, item.y, (item.diameter ?? 8) / 2, 48));
  } else if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = absoluteVectorPoints(item);
    if (points.length >= 2 && item.kind === "vector-path" && item.closed && item.filled) {
      loops.push(points);
    } else {
      loops.push(...strokeLoopsForPolyline(points, item.closed ?? false, stroke));
    }
  }

  return loops
    .map((loop) => normalizeCutoutLoop(loop, settings))
    .filter((loop): loop is Point2[] => Boolean(loop))
    .map((loop) => loop.reverse());
}

function svgForVectorItem(item: PanelItem) {
  const stroke = item.strokeWidth ?? DEFAULT_GRAPHIC_STROKE;
  const transform = `rotate(${round(item.rotation ?? 0)} ${round(item.x)} ${round(item.y)})`;
  if (item.kind === "artwork" && hasArtworkTrace(item)) {
    return artworkTraceLoops(item)
      .map((loop) => `<path d="${pathD(loop)} Z" fill="#111827" stroke="none" />`)
      .join("\n  ");
  }
  if (item.kind === "vector-circle") {
    return `<circle cx="${round(item.x)}" cy="${round(item.y)}" r="${round((item.diameter ?? 8) / 2)}" fill="${item.filled ? "#111827" : "none"}" stroke="#111827" stroke-width="${round(stroke)}" transform="${transform}" />`;
  }
  if (item.kind === "vector-rect") {
    const width = item.width ?? 12;
    const height = item.height ?? 8;
    return `<rect x="${round(item.x - width / 2)}" y="${round(item.y - height / 2)}" width="${round(width)}" height="${round(height)}" fill="${item.filled ? "#111827" : "none"}" stroke="#111827" stroke-width="${round(stroke)}" transform="${transform}" />`;
  }
  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = absoluteVectorPoints(item);
    if (points.length < 2) return "";
    const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${round(point[0])} ${round(point[1])}`).join(" ");
    return `<path d="${d}${item.closed ? " Z" : ""}" fill="${item.closed && item.filled ? "#111827" : "none"}" stroke="#111827" stroke-width="${round(stroke)}" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  return "";
}

function addDxfVectorItem(entities: string[], item: PanelItem) {
  if (item.kind === "artwork" && hasArtworkTrace(item)) {
    for (const loop of artworkTraceLoops(item)) addDxfLoop(entities, loop, true);
    return;
  }

  if (item.kind === "vector-circle") {
    addDxfCircle(entities, item.x, item.y, (item.diameter ?? 8) / 2);
    return;
  }

  if (item.kind === "vector-rect") {
    addDxfLoop(entities, rectLoop(item), true);
    return;
  }

  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = absoluteVectorPoints(item);
    if (points.length < 2) return;
    addDxfLoop(entities, points, item.closed ?? false);
  }
}

function addDxfLoop(entities: string[], points: Point2[], closed: boolean) {
  for (let index = 1; index < points.length; index += 1) {
    addDxfLine(entities, points[index - 1][0], points[index - 1][1], points[index][0], points[index][1]);
  }
  if (closed && points.length > 2) {
    addDxfLine(entities, points.at(-1)?.[0] ?? 0, points.at(-1)?.[1] ?? 0, points[0][0], points[0][1]);
  }
}

function gerberSegmentsForItem(item: PanelItem): Array<[Point2, Point2]> {
  if (item.kind === "text" && item.text) {
    return textSegments(item);
  }

  if (item.kind === "artwork") {
    if (hasArtworkTrace(item)) {
      return artworkTraceLoops(item).flatMap((loop) => [...fillSegmentsForPolygon(loop), ...loopSegments(loop, true)]);
    }
    const loop = rectLoop(item);
    return [...(item.filled ? fillSegmentsForPolygon(loop) : []), ...loopSegments(loop, true)];
  }

  if (item.kind === "vector-circle") {
    const loop = circleLoop2(item.x, item.y, (item.diameter ?? 8) / 2, 48);
    return [...(item.filled ? fillSegmentsForPolygon(loop) : []), ...loopSegments(loop, true)];
  }

  if (item.kind === "vector-rect") {
    const loop = rectLoop(item);
    return [...(item.filled ? fillSegmentsForPolygon(loop) : []), ...loopSegments(loop, true)];
  }

  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = absoluteVectorPoints(item);
    if (points.length < 2) return [];
    return [...(item.closed && item.filled ? fillSegmentsForPolygon(points) : []), ...loopSegments(points, item.closed ?? false)];
  }

  return [];
}

function defaultGerberLayer(item: PanelItem): GerberTargetLayer {
  if (item.stlMode === "reveal") return "frontMask";
  if (item.kind === "text" || item.kind === "artwork" || item.kind.startsWith("vector-")) return "frontSilk";
  return "none";
}

function fillSegmentsForPolygon(points: Point2[]): Array<[Point2, Point2]> {
  if (points.length < 3) return [];
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const segments: Array<[Point2, Point2]> = [];

  for (let y = Math.ceil(minY / GERBER_FILL_STEP) * GERBER_FILL_STEP; y <= maxY; y += GERBER_FILL_STEP) {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const ratio = (y - a[1]) / (b[1] - a[1]);
        intersections.push(a[0] + ratio * (b[0] - a[0]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 1; index < intersections.length; index += 2) {
      segments.push([
        [intersections[index - 1], y],
        [intersections[index], y],
      ]);
    }
  }

  return segments;
}

function addReliefForItem(facets: string[], item: PanelItem, zBase: number, blockers: Point2[][]) {
  const reliefHeight = item.reliefHeight ?? defaultReliefHeight(item);
  if (reliefHeight <= 0) return;
  const zRaised = zBase + reliefHeight;
  const stroke = Math.max(item.strokeWidth ?? DEFAULT_GRAPHIC_STROKE, 0.1);

  if (item.kind === "artwork" && hasArtworkTrace(item)) {
    for (const loop of artworkTraceLoops(item)) addRaisedLoop(facets, loop, zBase, zRaised, blockers);
    return;
  }

  if (item.kind === "text" || item.kind === "artwork") {
    addRaisedLoop(facets, rectLoop(item), zBase, zRaised, blockers);
    return;
  }

  if (item.kind === "vector-rect") {
    const loop = rectLoop(item);
    if (item.filled) {
      addRaisedLoop(facets, loop, zBase, zRaised, blockers);
    } else {
      addRaisedStrokePolyline(facets, loop, true, stroke, zBase, zRaised, blockers);
    }
    return;
  }

  if (item.kind === "vector-circle") {
    const loop = circleLoop2(item.x, item.y, (item.diameter ?? 8) / 2, 48);
    if (item.filled) {
      addRaisedLoop(facets, loop, zBase, zRaised, blockers);
    } else {
      addRaisedStrokePolyline(facets, loop, true, stroke, zBase, zRaised, blockers);
    }
    return;
  }

  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = absoluteVectorPoints(item);
    if (points.length < 2) return;
    if (item.closed && item.filled && points.length > 2) {
      addRaisedLoop(facets, points, zBase, zRaised, blockers);
      return;
    }
    addRaisedStrokePolyline(facets, points, item.closed ?? false, stroke, zBase, zRaised, blockers);
  }
}

function defaultReliefHeight(item: PanelItem) {
  if (item.kind === "text" || item.kind === "artwork" || item.kind.startsWith("vector-")) return 0.4;
  return 0;
}

function addRaisedLoop(facets: string[], loop: Point2[], zBase: number, zRaised: number, blockers: Point2[][] = []) {
  if (loop.length < 3) return;
  if (blockers.some((blocker) => loop.every((point) => pointInPolygon(point, blocker)))) return;
  const reliefHoles = blockers.filter((blocker) => shouldCutReliefLoop(loop, blocker)).map((blocker) => blocker.slice().reverse());
  const flat = loop.flatMap((point) => [point[0], point[1]]);
  const holeIndices: number[] = [];
  for (const blocker of reliefHoles) {
    holeIndices.push(flat.length / 2);
    for (const point of blocker) flat.push(point[0], point[1]);
  }
  const triangles = earcut(flat, holeIndices);
  for (let index = 0; index < triangles.length; index += 3) {
    addFacet(facets, pointAt(flat, triangles[index], zRaised), pointAt(flat, triangles[index + 1], zRaised), pointAt(flat, triangles[index + 2], zRaised));
  }
  addWall(facets, loop, zBase, zRaised, false);
  for (const blocker of reliefHoles) addWall(facets, blocker, zBase, zRaised, true);
}

function addRaisedStrokePolyline(facets: string[], points: Point2[], closed: boolean, stroke: number, zBase: number, zRaised: number, blockers: Point2[][]) {
  for (let index = 1; index < points.length; index += 1) {
    addRaisedLoop(facets, strokeLoop(points[index - 1], points[index], stroke), zBase, zRaised, blockers);
  }
  if (closed && points.length > 2) {
    addRaisedLoop(facets, strokeLoop(points.at(-1) ?? points[0], points[0], stroke), zBase, zRaised, blockers);
  }
}

function strokeLoopsForPolyline(points: Point2[], closed: boolean, stroke: number): Point2[][] {
  const loops: Point2[][] = [];
  for (let index = 1; index < points.length; index += 1) {
    loops.push(strokeLoop(points[index - 1], points[index], stroke));
  }
  if (closed && points.length > 2) {
    loops.push(strokeLoop(points.at(-1) ?? points[0], points[0], stroke));
  }
  return loops;
}

function normalizeCutoutLoop(loop: Point2[], settings: PanelSettings): Point2[] | null {
  const clamped = loop.map(
    ([x, y]) =>
      [
        clampMm(x, settings.widthMm),
        clampMm(y, settings.heightMm),
      ] as Point2,
  );
  const distinct = clamped.filter((point, index) => index === 0 || Math.hypot(point[0] - clamped[index - 1][0], point[1] - clamped[index - 1][1]) > 0.001);
  if (distinct.length > 2 && Math.hypot(distinct[0][0] - distinct.at(-1)![0], distinct[0][1] - distinct.at(-1)![1]) <= 0.001) {
    distinct.pop();
  }
  const area = Math.abs(polygonArea(distinct));
  return distinct.length >= 3 && area > 0.01 ? distinct : null;
}

function polygonArea(points: Point2[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function shouldCutReliefLoop(loop: Point2[], blocker: Point2[]) {
  const center = polygonCenter(blocker);
  return pointInPolygon(center, loop) || blocker.every((point) => pointInPolygon(point, loop));
}

function polygonCenter(points: Point2[]): Point2 {
  if (!points.length) return [0, 0];
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

function pointInPolygon(point: Point2, polygon: Point2[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects = a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || 1) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function rectLoop(item: PanelItem): Point2[] {
  const width =
    item.kind === "text" ? Math.max((item.text ?? item.label).length * (item.fontSize ?? 4) * 0.62, item.fontSize ?? 4) : item.width ?? 20;
  const height = item.kind === "text" ? item.fontSize ?? 4 : item.height ?? item.width ?? 20;
  const halfW = width / 2;
  const halfH = height / 2;
  return [
    rotateLocal(item, -halfW, -halfH),
    rotateLocal(item, halfW, -halfH),
    rotateLocal(item, halfW, halfH),
    rotateLocal(item, -halfW, halfH),
  ];
}

function strokeLoop(start: Point2, end: Point2, width: number): Point2[] {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (width / 2);
  const ny = (dx / length) * (width / 2);
  return [
    [start[0] + nx, start[1] + ny],
    [end[0] + nx, end[1] + ny],
    [end[0] - nx, end[1] - ny],
    [start[0] - nx, start[1] - ny],
  ];
}

function circleLoop2(x: number, y: number, radius: number, segments: number): Point2[] {
  return circleLoop(x, y, radius, segments).map((point) => [point[0], point[1]]);
}

function absoluteVectorPoints(item: PanelItem): Point2[] {
  return (item.points ?? []).map((point) => rotateLocal(item, point.x, point.y));
}

function artworkTraceLoops(item: PanelItem): Point2[][] {
  return artworkTracePathsForItem(item).map((path) => path.map((point) => [point.x, point.y] as Point2));
}

function rotateLocal(item: PanelItem, localX: number, localY: number): Point2 {
  const radians = ((item.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [item.x + localX * cos - localY * sin, item.y + localX * sin + localY * cos];
}

function pathD(points: Point2[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${round(point[0])} ${round(point[1])}`).join(" ");
}

function loopSegments(points: Point2[], closed: boolean): Array<[Point2, Point2]> {
  const segments: Array<[Point2, Point2]> = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1], points[index]]);
  }
  if (closed && points.length > 2) {
    segments.push([points.at(-1) ?? points[0], points[0]]);
  }
  return segments;
}

function textSegments(item: PanelItem): Array<[Point2, Point2]> {
  const text = (item.text ?? "").toUpperCase();
  const size = item.fontSize ?? 4;
  const scale = size / 7;
  const advance = 6 * scale;
  const totalWidth = Math.max((text.length - 1) * advance + 5 * scale, size);
  const left = -totalWidth / 2;
  const top = -size / 2;
  const segments: Array<[Point2, Point2]> = [];

  [...text].forEach((char, charIndex) => {
    const glyph = STROKE_FONT[char] ?? STROKE_FONT["?"];
    const xOffset = left + charIndex * advance;
    for (const [x1, y1, x2, y2] of glyph) {
      segments.push([rotateLocal(item, xOffset + x1 * scale, top + y1 * scale), rotateLocal(item, xOffset + x2 * scale, top + y2 * scale)]);
    }
  });

  return segments;
}

function clampMm(value: number, max: number) {
  return Math.min(max, Math.max(0, value));
}

function addDxfLine(entities: string[], x1: number, y1: number, x2: number, y2: number) {
  entities.push(`0
LINE
8
CUT
10
${round(x1)}
20
${round(y1)}
11
${round(x2)}
21
${round(y2)}
`);
}

function addDxfCircle(entities: string[], x: number, y: number, radius: number) {
  entities.push(`0
CIRCLE
8
CUT
10
${round(x)}
20
${round(y)}
40
${round(radius)}
`);
}

function addDxfText(entities: string[], x: number, y: number, size: number, rotation: number, text: string) {
  entities.push(`0
TEXT
8
SILK
10
${round(x)}
20
${round(y)}
40
${round(size)}
50
${round(rotation)}
1
${text.replace(/\r?\n/g, " ")}
`);
}

function addWall(facets: string[], loop: number[][], zBottom: number, zTop: number, inward: boolean) {
  for (let index = 0; index < loop.length; index += 1) {
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    const a: Point3 = [current[0], current[1], zBottom];
    const b: Point3 = [next[0], next[1], zBottom];
    const c: Point3 = [next[0], next[1], zTop];
    const d: Point3 = [current[0], current[1], zTop];
    if (inward) {
      addFacet(facets, a, c, b);
      addFacet(facets, a, d, c);
    } else {
      addFacet(facets, a, b, c);
      addFacet(facets, a, c, d);
    }
  }
}

function addFacet(facets: string[], a: Point3, b: Point3, c: Point3) {
  const normal = normalFor(a, b, c);
  facets.push(`facet normal ${f(normal[0])} ${f(normal[1])} ${f(normal[2])}
  outer loop
    vertex ${f(a[0])} ${f(a[1])} ${f(a[2])}
    vertex ${f(b[0])} ${f(b[1])} ${f(b[2])}
    vertex ${f(c[0])} ${f(c[1])} ${f(c[2])}
  endloop
endfacet`);
}

function normalFor(a: Point3, b: Point3, c: Point3): Point3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function circleLoop(x: number, y: number, radius: number, segments: number) {
  const safeRadius = Math.max(Math.abs(radius), 0.001);
  return Array.from({ length: segments }, (_, index) => {
    const angle = (Math.PI * 2 * index) / segments;
    return [x + Math.cos(angle) * safeRadius, y + Math.sin(angle) * safeRadius];
  });
}

function pointAt(flat: number[], index: number, z: number): Point3 {
  return [flat[index * 2], flat[index * 2 + 1], z];
}

function g(value: number) {
  return Math.round(value * MM_TO_GERBER).toString();
}

function drill(value: number) {
  return value.toFixed(3).replace(".", "");
}

function f(value: number) {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

function round(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
