import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import JSZip from "jszip";
import { boundsForPrimitives, parseDxf, parseExcellon, parseGerber } from "../src/gerber";
import type { GerberPrimitive } from "../src/types";

const root = resolve(".");
const requireFixtures = process.argv.includes("--require");
const requestedPaths = process.argv.slice(2).filter((arg) => arg !== "--require");
const scanRoots = requestedPaths.length > 0 ? requestedPaths.map((value) => resolve(value)) : [root, join(root, "fixtures", "gerbers")];
const skipDirs = new Set(["node_modules", "dist", ".tmp", ".git", "artifacts"]);
const supported = new Set([".gbr", ".ger", ".gtl", ".gbl", ".gto", ".gbo", ".gko", ".gm1", ".drl", ".xln", ".dxf", ".zip"]);

const files = unique(
  scanRoots.flatMap((scanRoot) =>
    filesFromPath(scanRoot).filter((filePath) => {
      const extension = extname(filePath).toLowerCase();
      return supported.has(extension);
    }),
  ),
);

if (files.length === 0) {
  const message = "no Gerber fixture files found; drop files into fixtures/gerbers or the project root to include them in npm test";
  if (requireFixtures) {
    throw new Error(message);
  }
  console.log(message);
  process.exit(0);
}

const candidates = (await Promise.all(files.map((filePath) => candidatesFromFile(filePath)))).flat();
if (candidates.length === 0) {
  throw new Error(`Gerber verification failed:\n${files.map((file) => `${relative(root, file)}: no supported Gerber entries`).join("\n")}`);
}

const failures: string[] = [];
const summaries = candidates.map((candidate) => {
  const primitives = parseByFileName(candidate.name, candidate.text);
  const bounds = boundsForPrimitives(primitives);
  const emptyValid = primitives.length === 0 && isValidEmptyLayer(candidate.name, candidate.text);

  if (primitives.length === 0 && !emptyValid) {
    failures.push(`${candidate.label}: parsed 0 primitives`);
  }

  if (!bounds && !emptyValid) {
    failures.push(`${candidate.label}: no bounds`);
  } else if (bounds && (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY)) {
    failures.push(`${candidate.label}: invalid bounds ${JSON.stringify(bounds)}`);
  }

  return {
    file: candidate.label,
    primitives: primitives.length,
    bounds,
    emptyValid,
  };
});

console.log(JSON.stringify({ checked: summaries.length, summaries }, null, 2));

if (failures.length > 0) {
  throw new Error(`Gerber verification failed:\n${failures.join("\n")}`);
}

function parseByFileName(filePath: string, text: string): GerberPrimitive[] {
  const extension = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();

  if (extension === ".drl" || extension === ".xln" || name.includes("drill")) {
    return parseExcellon(text);
  }

  if (extension === ".dxf") {
    return parseDxf(text);
  }

  return parseGerber(text);
}

async function candidatesFromFile(filePath: string) {
  if (extname(filePath).toLowerCase() !== ".zip") {
    return [
      {
        label: relative(root, filePath),
        name: basename(filePath),
        text: readFileSync(filePath, "utf8"),
      },
    ];
  }

  const zip = await JSZip.loadAsync(readFileSync(filePath));
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && supported.has(extname(entry.name).toLowerCase()) && extname(entry.name).toLowerCase() !== ".zip")
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    entries.map(async (entry) => ({
      label: `${relative(root, filePath)}::${entry.name}`,
      name: basename(entry.name),
      text: await entry.async("string"),
    })),
  );
}

function isValidEmptyLayer(filePath: string, text: string) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".drl" || extension === ".xln" || extension === ".dxf") return false;
  const hasEnd = /M02\*/i.test(text);
  const hasDrawOrFlash = /D0?1\*|D0?3\*/i.test(text);
  const fileFunction = text.match(/%TF\.FileFunction,([^*]+)\*%/i)?.[1] ?? "";
  const knownOptionalLayer = /Copper|Soldermask|Legend|Paste|Glue|Fab|User|Eco/i.test(fileFunction) || /paste/i.test(basename(filePath));
  return hasEnd && !hasDrawOrFlash && knownOptionalLayer;
}

function safeWalk(dir: string): string[] {
  try {
    const stat = statSync(dir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        result.push(...safeWalk(fullPath));
      }
      continue;
    }

    if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

function filesFromPath(path: string): string[] {
  try {
    const stat = statSync(path);
    if (stat.isFile()) return [path];
    if (stat.isDirectory()) return safeWalk(path);
  } catch {
    return [];
  }
  return [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}
