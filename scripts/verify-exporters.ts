import { DEFAULT_PANEL, SAMPLE_ITEMS } from "../src/defaults";
import { createDrill, createDxf, createGerberGraphicLayer, createGerberOutline, createStl, createSvg } from "../src/exporters";
import { parseExcellon, parseGerber } from "../src/gerber";

const svg = createSvg(DEFAULT_PANEL, SAMPLE_ITEMS);
const dxf = createDxf(DEFAULT_PANEL, SAMPLE_ITEMS);
const gerber = createGerberOutline(DEFAULT_PANEL);
const frontSilk = createGerberGraphicLayer(DEFAULT_PANEL, SAMPLE_ITEMS, "frontSilk");
const drill = createDrill(DEFAULT_PANEL, SAMPLE_ITEMS);
const stl = createStl(DEFAULT_PANEL, SAMPLE_ITEMS);
const barePanelStl = createStl(DEFAULT_PANEL, []);
const cutoutStl = createStl(DEFAULT_PANEL, [
  {
    id: "led-cutout",
    kind: "vector-circle",
    label: "LED cutout",
    x: 12,
    y: 28,
    diameter: 5,
    stlMode: "cutout",
    gerberLayer: "none",
  },
]);
const revealItems = [
  {
    id: "pcb-reveal",
    kind: "vector-rect" as const,
    label: "PCB reveal",
    x: 18,
    y: 30,
    width: 10,
    height: 8,
    filled: true,
    stlMode: "reveal" as const,
    gerberLayer: "frontReveal" as const,
  },
];
const revealStl = createStl(DEFAULT_PANEL, revealItems);
const revealFrontBase = createGerberGraphicLayer(DEFAULT_PANEL, revealItems, "frontMask");
const revealFrontCopper = createGerberGraphicLayer(DEFAULT_PANEL, revealItems, "frontCopper");
const revealFrontSilk = createGerberGraphicLayer(DEFAULT_PANEL, revealItems, "frontSilk");
const backRevealItems = revealItems.map((item) => ({
  ...item,
  id: "pcb-reveal-back",
  gerberLayer: "backReveal" as const,
}));
const revealBackBase = createGerberGraphicLayer(DEFAULT_PANEL, backRevealItems, "backMask");
const revealBackCopper = createGerberGraphicLayer(DEFAULT_PANEL, backRevealItems, "backCopper");
const revealBackSilk = createGerberGraphicLayer(DEFAULT_PANEL, backRevealItems, "backSilk");
const tracedArtworkItems = [
  {
    id: "trace-logo",
    kind: "artwork" as const,
    label: "Trace logo",
    x: 24,
    y: 28,
    width: 12,
    height: 8,
    rotation: 0,
    reliefHeight: 0.35,
    stlMode: "raised" as const,
    gerberLayer: "frontSilk" as const,
    filled: true,
    imageUrl: "data:image/png;base64,trace-fixture",
    artworkTrace: {
      sourceWidth: 10,
      sourceHeight: 10,
      gridWidth: 4,
      gridHeight: 4,
      threshold: 154,
      mode: "luma" as const,
      paths: [
        [
          { x: -0.25, y: -0.25 },
          { x: 0.25, y: -0.25 },
          { x: 0.25, y: 0.25 },
          { x: -0.25, y: 0.25 },
        ],
      ],
    },
  },
];
const tracedSvg = createSvg(DEFAULT_PANEL, tracedArtworkItems);
const tracedGerber = createGerberGraphicLayer(DEFAULT_PANEL, tracedArtworkItems, "frontSilk");
const tracedStl = createStl(DEFAULT_PANEL, tracedArtworkItems);

const untracedArtworkGerber = createGerberGraphicLayer(
  DEFAULT_PANEL,
  [
    {
      id: "untraced-artwork",
      kind: "artwork",
      label: "Untraced artwork",
      x: 20,
      y: 30,
      width: 12,
      height: 8,
      imageUrl: "data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E",
      filled: true,
      gerberLayer: "frontSilk",
    },
  ],
  "frontSilk",
);

assert(svg.includes("<svg") && svg.includes("<circle"), "SVG export missing expected geometry");
assert(dxf.includes("SECTION") && dxf.includes("CIRCLE"), "DXF export missing expected geometry");
assert(gerber.includes("%MOMM*%") && gerber.includes("M02*"), "Gerber outline export missing expected format");
assert(frontSilk.includes("D01*") && parseGerber(frontSilk).length > 0, "Gerber graphic export missing expected strokes");
assert(gerber.includes("%TF.FileFunction,Profile,NP*%"), "Gerber outline missing X2 profile metadata");
assert(frontSilk.includes("%TF.FileFunction,Legend,Top*%"), "Front silk missing X2 layer metadata");
assert(frontSilk.includes("%TF.FilePolarity,Positive*%"), "Gerber layer missing polarity metadata");
assert(drill.includes(";FORMAT={-:-/ absolute / metric / decimal}") && /^METRIC$/m.test(drill) && drill.includes("M30"), "Drill export missing explicit decimal metric format");
assert(/^X\d+\.\d{3}Y\d+\.\d{3}$/m.test(drill), "Drill export must use unambiguous decimal coordinates");
assert(drill.includes("; #@! TF.FileFunction,NonPlated,1,2,NPTH"), "Drill export missing non-plated file metadata");
assert(stl.includes("solid eurorack_panel") && stl.includes("facet normal"), "STL export missing expected facets");
assert(cutoutStl.includes("solid eurorack_panel") && !cutoutStl.includes("NaN"), "STL cutout export produced invalid geometry");
assert(revealStl === barePanelStl, "PCB reveal should not cut or raise STL geometry");
assert(!revealFrontBase.includes("%ADD11R"), "Soldermask export must not flash a full-panel opening");
assert(revealFrontBase.includes("%TF.FileFunction,Soldermask,Top*%") && revealFrontBase.includes("G36*"), "PCB reveal should create a solid front-mask opening");
assert(!revealFrontBase.includes("%LPC*%"), "PCB reveal mask opening should use positive polarity");
assert(revealFrontCopper.includes("%LPC*%") && revealFrontCopper.includes("G36*"), "PCB reveal should clear a solid region from front copper");
assert(revealFrontSilk.includes("%LPC*%") && revealFrontSilk.includes("G36*"), "PCB reveal should clear a solid region from front silk");
assert(revealBackBase.includes("%TF.FileFunction,Soldermask,Bot*%") && revealBackBase.includes("G36*"), "Back PCB reveal should create a solid back-mask opening");
assert(revealBackCopper.includes("%LPC*%") && revealBackCopper.includes("G36*"), "Back PCB reveal should clear a solid region from back copper");
assert(revealBackSilk.includes("%LPC*%") && revealBackSilk.includes("G36*"), "Back PCB reveal should clear a solid region from back silk");
assert(tracedSvg.includes("<path") && !tracedSvg.includes("<image"), "Traced artwork SVG export should use vectors");
assert(parseGerber(tracedGerber).length > 0, "Traced artwork Gerber export missing vector strokes");
assert(!untracedArtworkGerber.includes("D01*") && !untracedArtworkGerber.includes("G36*"), "Untraced artwork must not export its rectangular bounds to Gerber");
assert(tracedStl.includes("facet normal") && !tracedStl.includes("NaN"), "Traced artwork STL export produced invalid geometry");

const parsedGerber = parseGerber(`%FSLAX46Y46*%
%MOMM*%
%ADD10C,1.000000*%
D10*
X000000Y000000D02*
X010000Y000000D01*
X010000Y010000D01*
M02*`);
assert(parsedGerber.length >= 2, "Gerber parser did not read line primitives");

const parsedDrill = parseExcellon(`M48
METRIC,TZ
T01C3.200
%
T01
X010000Y020000
M30`);
assert(parsedDrill.length === 1 && parsedDrill[0].type === "circle", "Drill parser did not read a hole");

console.log("export verification ok");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
