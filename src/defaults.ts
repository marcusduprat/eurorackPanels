import type { GerberLayer, PanelItem, PanelSettings } from "./types";

export const DEFAULT_PANEL: PanelSettings = {
  hp: 12,
  widthMm: 12 * 5.08,
  heightMm: 128.5,
  thicknessMm: 2,
  mountHoleDiameter: 3.2,
  mountHoleInsetX: 7.5,
  mountHoleInsetY: 3,
  showMountingHoles: true,
  showPcbArea: true,
  pcbInsetX: 5,
  pcbInsetY: 8,
  pcbColor: "#0f7b55",
  gridMm: 2.54,
};

export const SAMPLE_ITEMS: PanelItem[] = [
  {
    id: "pot-cutoff",
    kind: "pot",
    label: "Cutoff",
    x: 30.48,
    y: 26,
    diameter: 7.2,
  },
  {
    id: "pot-reso",
    kind: "pot",
    label: "Res",
    x: 30.48,
    y: 55,
    diameter: 7.2,
  },
  {
    id: "jack-in",
    kind: "jack",
    label: "In",
    x: 18,
    y: 103,
    diameter: 6.4,
  },
  {
    id: "jack-out",
    kind: "jack",
    label: "Out",
    x: 42.5,
    y: 103,
    diameter: 6.4,
  },
  {
    id: "label-title",
    kind: "text",
    label: "Title",
    x: 30.48,
    y: 13,
    text: "FILTER",
    fontSize: 4.2,
    fontFamily: "Inter, Arial, sans-serif",
    fontWeight: 760,
    fontStyle: "normal",
    rotation: 0,
    reliefHeight: 0.4,
    stlMode: "raised",
    gerberLayer: "frontSilk",
  },
];

export const SAMPLE_LAYERS: GerberLayer[] = [
  {
    id: "sample-pcb",
    name: "PCB reference",
    fileName: "sample-board.gbr",
    kind: "gerber",
    color: "#1f9d8a",
    opacity: 0.42,
    visible: true,
    offsetX: 6,
    offsetY: 9,
    rotation: 0,
    mirrorX: false,
    bounds: { minX: 0, minY: 0, maxX: 49, maxY: 108 },
    primitives: [
      { type: "rect", x: 24.5, y: 54, width: 49, height: 108 },
      { type: "circle", x: 24.5, y: 17, r: 7.2 },
      { type: "circle", x: 24.5, y: 46, r: 7.2 },
      { type: "circle", x: 12, y: 94, r: 6.4 },
      { type: "circle", x: 36.5, y: 94, r: 6.4 },
      { type: "line", x1: 12, y1: 17, x2: 36.5, y2: 17, stroke: 0.35 },
      { type: "line", x1: 24.5, y1: 24, x2: 24.5, y2: 39, stroke: 0.35 },
      { type: "line", x1: 12, y1: 94, x2: 36.5, y2: 94, stroke: 0.35 },
      { type: "line", x1: 12, y1: 94, x2: 24.5, y2: 46, stroke: 0.22 },
      { type: "line", x1: 36.5, y1: 94, x2: 24.5, y2: 46, stroke: 0.22 },
    ],
  },
];

export const LAYER_COLORS = ["#1f9d8a", "#c78217", "#4760d1", "#b2466c", "#476b3f", "#8757c7"];
