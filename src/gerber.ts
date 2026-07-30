import type { Bounds, GerberPrimitive } from "./types";

type Aperture = {
  shape: string;
  params: number[];
};

type GerberState = {
  unitFactor: number;
  xDecimals: number;
  yDecimals: number;
  x: number;
  y: number;
  aperture: number;
  operation: 1 | 2 | 3;
  interpolation: "linear" | "cw" | "ccw";
  apertures: Map<number, Aperture>;
};

const DEFAULT_STROKE = 0.12;

export function parseGerber(text: string): GerberPrimitive[] {
  const state: GerberState = {
    unitFactor: 1,
    xDecimals: 4,
    yDecimals: 4,
    x: 0,
    y: 0,
    aperture: 10,
    operation: 2,
    interpolation: "linear",
    apertures: new Map(),
  };
  const primitives: GerberPrimitive[] = [];
  const tokens = text
    .replace(/\r/g, "")
    .split("*")
    .map((token) => token.trim())
    .filter(Boolean);

  for (const rawToken of tokens) {
    const token = rawToken.replace(/^%/, "").replace(/%$/, "").trim();

    if (!token || token.startsWith("G04")) {
      continue;
    }

    const format = token.match(/FS[LT]?A?X(\d)(\d)Y(\d)(\d)/i);
    if (format) {
      state.xDecimals = Number(format[2]);
      state.yDecimals = Number(format[4]);
      continue;
    }

    if (/^MO(IN|I)/i.test(token)) {
      state.unitFactor = 25.4;
      continue;
    }

    if (/^MO(MM|M)/i.test(token)) {
      state.unitFactor = 1;
      continue;
    }

    const apertureDef = token.match(/^ADD(\d+)([A-Z]),?(.+)?$/i);
    if (apertureDef) {
      const code = Number(apertureDef[1]);
      const shape = apertureDef[2].toUpperCase();
      const params = (apertureDef[3] ?? "")
        .split(/[Xx,]/)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => value * state.unitFactor);
      state.apertures.set(code, { shape, params });
      continue;
    }

    if (/G0?1/i.test(token)) state.interpolation = "linear";
    if (/G0?2/i.test(token)) state.interpolation = "cw";
    if (/G0?3/i.test(token)) state.interpolation = "ccw";

    const hasX = /X[+-]?\d*\.?\d+/i.test(token);
    const hasY = /Y[+-]?\d*\.?\d+/i.test(token);
    const dCodes = [...token.matchAll(/D(\d+)/gi)].map((match) => Number(match[1]));
    const lastD = dCodes.at(-1);

    if (!hasX && !hasY && lastD !== undefined && lastD >= 10) {
      state.aperture = lastD;
      continue;
    }

    const nextX = hasX ? parseCoord(token.match(/X([+-]?\d*\.?\d+)/i)?.[1] ?? "0", state.xDecimals, state.unitFactor) : state.x;
    const nextY = hasY ? -parseCoord(token.match(/Y([+-]?\d*\.?\d+)/i)?.[1] ?? "0", state.yDecimals, state.unitFactor) : state.y;

    let operation = state.operation;
    if (lastD === 1 || lastD === 2 || lastD === 3) {
      operation = lastD;
      state.operation = lastD;
    }

    if (operation === 1 && (hasX || hasY)) {
      const stroke = currentStroke(state);
      const iMatch = token.match(/I([+-]?\d*\.?\d+)/i);
      const jMatch = token.match(/J([+-]?\d*\.?\d+)/i);

      if (state.interpolation !== "linear" && iMatch && jMatch) {
        const center = {
          x: state.x + parseCoord(iMatch[1], state.xDecimals, state.unitFactor),
          y: state.y - parseCoord(jMatch[1], state.yDecimals, state.unitFactor),
        };
        primitives.push(
          ...arcAsLines(
            { x: state.x, y: state.y },
            { x: nextX, y: nextY },
            center,
            stroke,
            state.interpolation === "cw" ? "ccw" : "cw",
          ),
        );
      } else {
        primitives.push({ type: "line", x1: state.x, y1: state.y, x2: nextX, y2: nextY, stroke });
      }
    }

    if (operation === 3 && (hasX || hasY)) {
      primitives.push(flashPrimitive(nextX, nextY, currentAperture(state)));
    }

    state.x = nextX;
    state.y = nextY;
  }

  return primitives;
}

export function parseExcellon(text: string): GerberPrimitive[] {
  const primitives: GerberPrimitive[] = [];
  const tools = new Map<string, number>();
  let currentTool = "";
  let unitFactor = 1;
  let x = 0;
  let y = 0;
  let routing = false;
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    if (/INCH/i.test(line)) unitFactor = 25.4;
    if (/METRIC/i.test(line)) unitFactor = 1;
    const toolDef = line.match(/^T(\d+)C([0-9.]+)/i);
    if (toolDef) { tools.set(toolDef[1], Number(toolDef[2]) * unitFactor); continue; }
    const toolSelect = line.match(/^T(\d+)$/i);
    if (toolSelect) { currentTool = toolSelect[1]; continue; }
    if (/^M15$/i.test(line)) { routing = true; continue; }
    if (/^M16$/i.test(line)) { routing = false; continue; }
    if (!/[XY]/i.test(line)) continue;
    const previousX = x;
    const previousY = y;
    const xMatch = line.match(/X([+-]?\d*\.?\d+)/i);
    const yMatch = line.match(/Y([+-]?\d*\.?\d+)/i);
    if (xMatch) x = parseDrillCoord(xMatch[1], unitFactor);
    if (yMatch) y = -parseDrillCoord(yMatch[1], unitFactor);
    const diameter = tools.get(currentTool) ?? 1;
    if (routing && /^G0?1/i.test(line)) primitives.push({ type: "line", x1: previousX, y1: previousY, x2: x, y2: y, stroke: diameter });
    else if (!/^G0?0/i.test(line)) primitives.push({ type: "circle", x, y, r: diameter / 2 });
  }
  return primitives;
}
export function parseDxf(text: string): GerberPrimitive[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index < lines.length - 1; index += 2) {
    pairs.push([lines[index].trim(), lines[index + 1].trim()]);
  }

  const primitives: GerberPrimitive[] = [];
  let index = 0;
  while (index < pairs.length) {
    const [code, value] = pairs[index];
    if (code !== "0") {
      index += 1;
      continue;
    }

    const entity = value.toUpperCase();
    const entityPairs: Array<[string, string]> = [];
    index += 1;
    while (index < pairs.length && pairs[index][0] !== "0") {
      entityPairs.push(pairs[index]);
      index += 1;
    }

    if (entity === "LINE") {
      const x1 = readDxfNumber(entityPairs, "10");
      const y1 = -readDxfNumber(entityPairs, "20");
      const x2 = readDxfNumber(entityPairs, "11");
      const y2 = -readDxfNumber(entityPairs, "21");
      primitives.push({ type: "line", x1, y1, x2, y2, stroke: DEFAULT_STROKE });
    }

    if (entity === "CIRCLE") {
      const x = readDxfNumber(entityPairs, "10");
      const y = -readDxfNumber(entityPairs, "20");
      const r = readDxfNumber(entityPairs, "40");
      primitives.push({ type: "circle", x, y, r });
    }

    if (entity === "ARC") {
      const center = { x: readDxfNumber(entityPairs, "10"), y: -readDxfNumber(entityPairs, "20") };
      const radius = readDxfNumber(entityPairs, "40");
      const startDeg = readDxfNumber(entityPairs, "50");
      const endDeg = readDxfNumber(entityPairs, "51");
      const start = {
        x: center.x + Math.cos((startDeg * Math.PI) / 180) * radius,
        y: center.y - Math.sin((startDeg * Math.PI) / 180) * radius,
      };
      const end = {
        x: center.x + Math.cos((endDeg * Math.PI) / 180) * radius,
        y: center.y - Math.sin((endDeg * Math.PI) / 180) * radius,
      };
      primitives.push(...arcAsLines(start, end, center, DEFAULT_STROKE, "cw"));
    }

    if (entity === "LWPOLYLINE") {
      const points: Array<{ x: number; y: number }> = [];
      for (let pairIndex = 0; pairIndex < entityPairs.length; pairIndex += 1) {
        if (entityPairs[pairIndex][0] === "10") {
          const x = Number(entityPairs[pairIndex][1]);
          const yPair = entityPairs.slice(pairIndex + 1).find(([pairCode]) => pairCode === "20");
          if (Number.isFinite(x) && yPair) {
            points.push({ x, y: -Number(yPair[1]) });
          }
        }
      }
      for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
        primitives.push({
          type: "line",
          x1: points[pointIndex - 1].x,
          y1: points[pointIndex - 1].y,
          x2: points[pointIndex].x,
          y2: points[pointIndex].y,
          stroke: DEFAULT_STROKE,
        });
      }
    }
  }

  return primitives;
}

export function boundsForPrimitives(primitives: GerberPrimitive[]): Bounds | null {
  let bounds: Bounds | null = null;

  for (const primitive of primitives) {
    let next: Bounds;
    if (primitive.type === "line") {
      const pad = primitive.stroke / 2;
      next = {
        minX: Math.min(primitive.x1, primitive.x2) - pad,
        minY: Math.min(primitive.y1, primitive.y2) - pad,
        maxX: Math.max(primitive.x1, primitive.x2) + pad,
        maxY: Math.max(primitive.y1, primitive.y2) + pad,
      };
    } else if (primitive.type === "circle") {
      next = {
        minX: primitive.x - primitive.r,
        minY: primitive.y - primitive.r,
        maxX: primitive.x + primitive.r,
        maxY: primitive.y + primitive.r,
      };
    } else {
      const width = Math.abs(primitive.width);
      const height = Math.abs(primitive.height);
      next = {
        minX: primitive.x - width / 2,
        minY: primitive.y - height / 2,
        maxX: primitive.x + width / 2,
        maxY: primitive.y + height / 2,
      };
    }

    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, next.minX),
          minY: Math.min(bounds.minY, next.minY),
          maxX: Math.max(bounds.maxX, next.maxX),
          maxY: Math.max(bounds.maxY, next.maxY),
        }
      : next;
  }

  return bounds;
}

function parseCoord(raw: string, decimals: number, unitFactor: number) {
  if (raw.includes(".")) {
    return Number(raw) * unitFactor;
  }

  const sign = raw.startsWith("-") ? -1 : 1;
  const body = raw.replace(/^[+-]/, "");
  return (sign * Number(body) * unitFactor) / 10 ** decimals;
}

function parseDrillCoord(raw: string, unitFactor: number) {
  if (raw.includes(".")) {
    return Number(raw) * unitFactor;
  }

  const sign = raw.startsWith("-") ? -1 : 1;
  const body = raw.replace(/^[+-]/, "");
  const decimals = unitFactor === 25.4 ? 4 : 3;
  return (sign * Number(body) * unitFactor) / 10 ** decimals;
}

function currentAperture(state: GerberState): Aperture {
  return state.apertures.get(state.aperture) ?? { shape: "C", params: [DEFAULT_STROKE] };
}

function currentStroke(state: GerberState) {
  const aperture = currentAperture(state);
  return aperture.shape === "C" ? aperture.params[0] ?? DEFAULT_STROKE : DEFAULT_STROKE;
}

function flashPrimitive(x: number, y: number, aperture: Aperture): GerberPrimitive {
  if (aperture.shape === "R") {
    return {
      type: "rect",
      x,
      y,
      width: positiveDimension(aperture.params[0] ?? 1),
      height: positiveDimension(aperture.params[1] ?? aperture.params[0] ?? 1),
    };
  }

  if (aperture.shape === "O") {
    return {
      type: "rect",
      x,
      y,
      width: positiveDimension(aperture.params[0] ?? 1),
      height: positiveDimension(aperture.params[1] ?? aperture.params[0] ?? 1),
    };
  }

  return { type: "circle", x, y, r: positiveDimension(aperture.params[0] ?? 1) / 2 };
}

function positiveDimension(value: number) {
  return Math.max(Math.abs(value), 0.001);
}

function arcAsLines(
  start: { x: number; y: number },
  end: { x: number; y: number },
  center: { x: number; y: number },
  stroke: number,
  direction: "cw" | "ccw",
): GerberPrimitive[] {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  if (!Number.isFinite(radius) || radius <= 0.001) return [];

  let startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let endAngle = Math.atan2(end.y - center.y, end.x - center.x);

  if (direction === "ccw") {
    while (endAngle <= startAngle) endAngle += Math.PI * 2;
  } else {
    while (endAngle >= startAngle) endAngle -= Math.PI * 2;
  }

  const sweep = endAngle - startAngle;
  const segments = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
  const primitives: GerberPrimitive[] = [];
  let prev = start;

  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + (sweep * index) / segments;
    const next = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
    primitives.push({ type: "line", x1: prev.x, y1: prev.y, x2: next.x, y2: next.y, stroke });
    prev = next;
  }

  return primitives;
}

function readDxfNumber(pairs: Array<[string, string]>, code: string) {
  const value = Number(pairs.find(([pairCode]) => pairCode === code)?.[1] ?? 0);
  return Number.isFinite(value) ? value : 0;
}
