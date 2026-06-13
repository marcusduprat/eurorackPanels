import { DEFAULT_PANEL, SAMPLE_ITEMS } from "../src/defaults";
import { createDrill, createDxf, createGerberGraphicLayer, createGerberOutline, createStl, createSvg } from "../src/exporters";
import { parseExcellon, parseGerber } from "../src/gerber";

const svg = createSvg(DEFAULT_PANEL, SAMPLE_ITEMS);
const dxf = createDxf(DEFAULT_PANEL, SAMPLE_ITEMS);
const gerber = createGerberOutline(DEFAULT_PANEL);
const frontSilk = createGerberGraphicLayer(DEFAULT_PANEL, SAMPLE_ITEMS, "frontSilk");
const drill = createDrill(DEFAULT_PANEL, SAMPLE_ITEMS);
const stl = createStl(DEFAULT_PANEL, SAMPLE_ITEMS);
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

assert(svg.includes("<svg") && svg.includes("<circle"), "SVG export missing expected geometry");
assert(dxf.includes("SECTION") && dxf.includes("CIRCLE"), "DXF export missing expected geometry");
assert(gerber.includes("%MOMM*%") && gerber.includes("M02*"), "Gerber outline export missing expected format");
assert(frontSilk.includes("D01*") && parseGerber(frontSilk).length > 0, "Gerber graphic export missing expected strokes");
assert(drill.includes("METRIC,TZ") && drill.includes("M30"), "Drill export missing expected format");
assert(stl.includes("solid eurorack_panel") && stl.includes("facet normal"), "STL export missing expected facets");
assert(cutoutStl.includes("solid eurorack_panel") && !cutoutStl.includes("NaN"), "STL cutout export produced invalid geometry");

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
