# Panel Bench

Local Eurorack panel layout tool for aligning panel cutouts/artwork against PCB Gerber or drill exports.

## Run

```bash
npm install
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173`.

## Current Capabilities

- Set Eurorack panel HP, width, height, thickness, grid, and mounting-hole positions.
- Import PCB Gerbers, Excellon drill files, and DXF drawings as translucent alignment layers.
- Import Gerber ZIP bundles directly.
- Import PNG, JPG, WebP, SVG artwork as movable panel artwork.
- Place and edit pots, jacks, holes, labels, and artwork in millimeters.
- Save/load project JSON.
- Export SVG, DXF, Gerber outline + drill file, and STL for 3D printing.

## Checks

```bash
npm test
npm run build
npm run verify:exports
npm run verify:gerbers
npm run verify:gerbers:required
```

`npm run verify:gerbers` scans `fixtures/gerbers` and the project root for Gerber, Excellon drill, DXF, and ZIP bundle files. If files are present, they must parse into visible geometry and valid bounds.
`npm run verify:gerbers:required` is the stricter check to use when you expect a real file to be present; it fails if no fixture is found.
You can also point it at a specific file or folder:

```bash
npm run verify:gerbers -- "C:\path\to\gerber-folder"
npm run verify:gerbers -- "C:\path\to\GERBER-project.zip"
```

The Gerber parser is intentionally pragmatic in this first local version: it handles common KiCad-style Gerber and Excellon output for visual alignment, not every RS-274X edge case.

## Public Repo Note

Real Gerber, drill, KiCad, STL, DXF, ZIP, and local screenshot exports are ignored by default because they can expose private board-design details. The files in `fixtures/gerbers/sample-*` are tiny synthetic fixtures kept only so parser checks work in a fresh public clone.

## Rendered Import Smoke Test

```bash
$env:GERBER_IMPORT_TARGET = "C:\path\to\gerber-folder-or.zip"
npm run smoke:import
```

This launches the local app, uploads the Gerber/drill/DXF files or ZIP bundle through the actual import control, and checks that imported layers appear without browser errors.
