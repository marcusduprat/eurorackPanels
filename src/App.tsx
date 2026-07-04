import {
  AlignCenter,
  Box,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Circle,
  Copy,
  Crosshair,
  Download,
  FileDown,
  FileImage,
  FolderOpen,
  Grid2X2,
  Hand,
  Hexagon,
  Image,
  Layers,
  Minus,
  MousePointer2,
  Move,
  PenLine,
  Plus,
  RefreshCcw,
  Redo2,
  Ruler,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import JSZip from "jszip";
import * as THREE from "three";
import { artworkTracePathsForItem, hasArtworkTrace, traceImageToArtwork, type TraceImageOptions } from "./artworkTrace";
import { DEFAULT_PANEL, LAYER_COLORS, SAMPLE_ITEMS, SAMPLE_LAYERS } from "./defaults";
import {
  createDrill,
  createDxf,
  createGerberGraphicLayer,
  createGerberOutline,
  createStl,
  createSvg,
  downloadText,
  panelHoles,
} from "./exporters";
import { boundsForPrimitives, parseDxf, parseExcellon, parseGerber } from "./gerber";
import type { DragState, GerberLayer, GerberPrimitive, GerberTargetLayer, PanelItem, PanelItemKind, PanelSettings, StlGraphicMode, ToolMode, TraceMode } from "./types";

type Selection = { type: "item" | "layer"; id: string } | null;
type ViewState = { x: number; y: number; zoom: number };
type Size = { width: number; height: number };
type EditorSnapshot = {
  settings: PanelSettings;
  items: PanelItem[];
  layers: GerberLayer[];
  layerColors: Record<GerberTargetLayer, string>;
  selection: Selection;
};
type LayerPathBatch = { stroke: number; d: string };
type LayerPaths = { lineBatches: LayerPathBatch[]; outlinePath: string };
type Point2D = { x: number; y: number };
type ThreeCutoutShape = { shape: THREE.Shape; kind: "physical" | "graphic" };
type PreviewView = { angle: number; tilt: number; zoom: number };

const MIN_ZOOM = 1.4;
const MAX_ZOOM = 12;
const WHEEL_ZOOM_FACTOR = 1.18;
const PATH_CLOSE_DISTANCE_MM = 2.2;

const toolOptions: Array<{ mode: ToolMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: "select", label: "Select", icon: MousePointer2 },
  { mode: "pot", label: "Pot", icon: Circle },
  { mode: "jack", label: "Jack", icon: Crosshair },
  { mode: "hole", label: "Hole", icon: Plus },
  { mode: "text", label: "Text", icon: Type },
  { mode: "vector-circle", label: "Draw circle", icon: Circle },
  { mode: "vector-rect", label: "Draw rectangle", icon: Square },
  { mode: "vector-line", label: "Draw line", icon: Minus },
  { mode: "vector-path", label: "Draw path", icon: PenLine },
];

const gerberTargetOptions: Array<{ value: GerberTargetLayer; label: string }> = [
  { value: "none", label: "None" },
  { value: "frontMask", label: "Front base" },
  { value: "frontSilk", label: "Front silk" },
  { value: "frontCopper", label: "Front copper" },
  { value: "frontReveal", label: "Front PCB reveal" },
  { value: "backMask", label: "Back base" },
  { value: "backSilk", label: "Back silk" },
  { value: "backCopper", label: "Back copper" },
  { value: "backReveal", label: "Back PCB reveal" },
];

const objectLayerSections: Array<{ value: GerberTargetLayer; label: string; color: string }> = [
  { value: "none", label: "Cutouts / none", color: "#64748b" },
  { value: "frontMask", label: "Front base", color: "#1f9d8a" },
  { value: "frontCopper", label: "Front copper", color: "#c86f0f" },
  { value: "frontSilk", label: "Front silk", color: "#2f5ea8" },
  { value: "frontReveal", label: "Front PCB reveal", color: "#29a36f" },
  { value: "backMask", label: "Back base", color: "#6b9f3f" },
  { value: "backCopper", label: "Back copper", color: "#b2466c" },
  { value: "backSilk", label: "Back silk", color: "#8757c7" },
  { value: "backReveal", label: "Back PCB reveal", color: "#74ad4d" },
];

const defaultObjectLayerColors = Object.fromEntries(objectLayerSections.map((section) => [section.value, section.color])) as Record<GerberTargetLayer, string>;

const newGraphicLayerOptions = gerberTargetOptions.filter((option) => option.value !== "none");

const materialPalette = [
  { label: "PCB green", color: "#1f9d6a" },
  { label: "Copper", color: "#b87333" },
  { label: "Black mask", color: "#1f2937" },
  { label: "White silk", color: "#f8fafc" },
  { label: "Silver", color: "#aab4c2" },
  { label: "Red", color: "#d83b3b" },
  { label: "Blue", color: "#2f5ea8" },
  { label: "Yellow", color: "#e0a51b" },
];

const stlModeOptions: Array<{ value: StlGraphicMode; label: string }> = [
  { value: "raised", label: "Raised" },
  { value: "reveal", label: "PCB reveal" },
  { value: "cutout", label: "Cut hole" },
];

const traceModeOptions: Array<{ value: TraceMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "dark", label: "Dark ink" },
  { value: "light", label: "Light ink" },
  { value: "alpha", label: "Transparency" },
];

const traceDetailOptions = [
  { value: "64", label: "Draft" },
  { value: "96", label: "Normal" },
  { value: "128", label: "Fine" },
  { value: "192", label: "Extra fine" },
];

const holePresetOptions = [
  { value: "custom", label: "Custom" },
  { value: "3", label: "LED 3 mm" },
  { value: "5", label: "LED 5 mm" },
  { value: "6", label: "LED bezel 6 mm" },
  { value: "3.2", label: "M3 screw 3.2 mm" },
];

const fontOptions = [
  { value: "Inter, Arial, sans-serif", label: "Inter" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: '"Courier New", monospace', label: "Courier" },
  { value: "Impact, Haettenschweiler, sans-serif", label: "Impact" },
];

function App() {
  const [settings, setSettings] = useState<PanelSettings>(DEFAULT_PANEL);
  const [items, setItems] = useState<PanelItem[]>(SAMPLE_ITEMS);
  const [layers, setLayers] = useState<GerberLayer[]>(SAMPLE_LAYERS);
  const [selection, setSelection] = useState<Selection>({ type: "item", id: SAMPLE_ITEMS[0].id });
  const [tool, setTool] = useState<ToolMode>("select");
  const [view, setView] = useState<ViewState>({ x: -54, y: -8, zoom: 4.2 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [defaultGraphicLayer, setDefaultGraphicLayer] = useState<GerberTargetLayer>("frontSilk");
  const [layerColors, setLayerColors] = useState<Record<GerberTargetLayer, string>>(defaultObjectLayerColors);
  const [collapsedObjectLayers, setCollapsedObjectLayers] = useState<GerberTargetLayer[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [copiedItem, setCopiedItem] = useState<PanelItem | null>(null);
  const [canvasSize, setCanvasSize] = useState<Size>({ width: 900, height: 640 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const gerberInputRef = useRef<HTMLInputElement | null>(null);
  const artworkInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const dragHistoryCommittedRef = useRef(false);
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);

  const selectedItem = selection?.type === "item" ? items.find((item) => item.id === selection.id) ?? null : null;
  const selectedLayer = selection?.type === "layer" ? layers.find((layer) => layer.id === selection.id) ?? null : null;
  const holes = useMemo(() => panelHoles(settings, items), [settings, items]);
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setCanvasSize({
        width: Math.max(320, entry.contentRect.width),
        height: Math.max(280, entry.contentRect.height),
      });
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingText = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && key === "z" && !isEditingText) {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if (modifier && key === "y" && !isEditingText) {
        event.preventDefault();
        redo();
      }
      if (modifier && key === "c" && !isEditingText) {
        event.preventDefault();
        copySelection();
      }
      if (modifier && key === "v" && !isEditingText) {
        event.preventDefault();
        pasteCopiedItem();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (isEditingText) return;
        deleteSelection();
      }
      if (event.key === "Escape") {
        setTool("select");
        setActivePathId(null);
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = svg.getScreenCTM()?.inverse();
      if (!matrix) return;

      const anchor = point.matrixTransform(matrix);
      const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const wheelSteps = clamp(-event.deltaY / 100, -4, 4);
      const zoomFactor = WHEEL_ZOOM_FACTOR ** wheelSteps;

      setView((current) => {
        const nextZoom = clamp(current.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);
        return {
          x: anchor.x - (canvasSize.width / nextZoom) * ratioX,
          y: anchor.y - (canvasSize.height / nextZoom) * ratioY,
          zoom: nextZoom,
        };
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [canvasSize.height, canvasSize.width]);

  const viewBox = `${view.x} ${view.y} ${canvasSize.width / view.zoom} ${canvasSize.height / view.zoom}`;

  function snapshot(): EditorSnapshot {
    return { settings, items, layers, layerColors, selection };
  }

  function pushHistory() {
    const next = snapshot();
    setPast((current) => [...current.slice(-49), next]);
    setFuture([]);
  }

  function applySnapshot(next: EditorSnapshot) {
    setSettings(next.settings);
    setItems(next.items);
    setLayers(next.layers);
    setLayerColors(next.layerColors ?? defaultObjectLayerColors);
    setSelection(next.selection);
  }

  function undo() {
    setPast((current) => {
      const previous = current.at(-1);
      if (!previous) return current;
      setFuture((redoStack) => [snapshot(), ...redoStack.slice(0, 49)]);
      applySnapshot(previous);
      return current.slice(0, -1);
    });
  }

  function redo() {
    setFuture((current) => {
      const next = current[0];
      if (!next) return current;
      setPast((undoStack) => [...undoStack.slice(-49), snapshot()]);
      applySnapshot(next);
      return current.slice(1);
    });
  }

  function updatePanel(next: Partial<PanelSettings>) {
    pushHistory();
    setSettings((current) => {
      const hp = next.hp ?? current.hp;
      const widthMm = next.widthMm ?? (next.hp !== undefined ? hp * 5.08 : current.widthMm);
      return { ...current, ...next, hp, widthMm };
    });
  }

  function updateItem(id: string, patch: Partial<PanelItem>, record = true) {
    if (record) pushHistory();
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function updateLayer(id: string, patch: Partial<GerberLayer>) {
    pushHistory();
    setLayers((current) => current.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  }

  function updateObjectLayerColor(layer: GerberTargetLayer, color: string) {
    pushHistory();
    setLayerColors((current) => ({ ...current, [layer]: color }));
  }

  function assignItemLayer(id: string, gerberLayer: GerberTargetLayer) {
    const item = items.find((entry) => entry.id === id);
    if (!item || !isGraphicItem(item) || item.gerberLayer === gerberLayer) return;
    pushHistory();
    setItems((current) => current.map((entry) => (entry.id === id ? { ...entry, gerberLayer, stlMode: stlModeForGerberLayer(gerberLayer, entry.stlMode) } : entry)));
    setSelection({ type: "item", id });
  }

  function toggleObjectLayer(layer: GerberTargetLayer) {
    setCollapsedObjectLayers((current) => (current.includes(layer) ? current.filter((entry) => entry !== layer) : [...current, layer]));
  }

  function addItem(kind: PanelItemKind, x = settings.widthMm / 2, y = settings.heightMm / 2) {
    pushHistory();
    const id = crypto.randomUUID();
    const base: PanelItem = {
      id,
      kind,
      label: labelForKind(kind),
      x: snap(x),
      y: snap(y),
      rotation: 0,
      opacity: 1,
    };
    const item =
      kind === "pot"
        ? { ...base, diameter: 7.2 }
        : kind === "jack"
          ? { ...base, diameter: 6.4 }
          : kind === "hole"
            ? { ...base, diameter: 3.2 }
            : kind === "text"
              ? { ...base, ...graphicDefaults(defaultGraphicLayer), text: "LABEL", fontSize: 4, fontFamily: fontOptions[0].value, fontWeight: 760, fontStyle: "normal" as const }
              : kind === "vector-circle"
                ? { ...base, ...graphicDefaults(defaultGraphicLayer), diameter: 8, strokeWidth: 0.24 }
                : kind === "vector-rect"
                  ? { ...base, ...graphicDefaults(defaultGraphicLayer), width: 12, height: 8, strokeWidth: 0.24 }
                  : kind === "vector-line"
                    ? { ...base, ...graphicDefaults(defaultGraphicLayer), points: [{ x: -5, y: 0 }, { x: 5, y: 0 }], strokeWidth: 0.24 }
                    : kind === "vector-path"
                      ? { ...base, ...graphicDefaults(defaultGraphicLayer), points: [{ x: 0, y: 0 }], strokeWidth: 0.24, closed: false }
                      : { ...base, ...graphicDefaults(defaultGraphicLayer), width: 20, height: 20 };
    setItems((current) => [...current, item]);
    setSelection({ type: "item", id });
    setTool("select");
  }

  function beginShapeDraw(kind: "vector-circle" | "vector-rect" | "vector-line", start: { x: number; y: number }) {
    pushHistory();
    const id = crypto.randomUUID();
    const x = snap(start.x);
    const y = snap(start.y);
    const base: PanelItem = {
      id,
      kind,
      label: labelForKind(kind),
      x,
      y,
      rotation: 0,
      opacity: 1,
      ...graphicDefaults(defaultGraphicLayer),
      strokeWidth: 0.24,
    };
    const item: PanelItem =
      kind === "vector-circle"
        ? { ...base, diameter: settings.gridMm }
        : kind === "vector-rect"
          ? { ...base, width: settings.gridMm, height: settings.gridMm }
          : { ...base, points: [{ x: 0, y: 0 }, { x: settings.gridMm, y: 0 }] };
    setItems((current) => [...current, item]);
    setSelection({ type: "item", id });
    setDrag({ type: "shape", id, kind, startX: x, startY: y });
  }

  function updateDrawnShape(shape: Extract<DragState, { type: "shape" }>, point: { x: number; y: number }, forceSquare: boolean) {
    const endX = snap(point.x);
    const endY = snap(point.y);
    const dx = endX - shape.startX;
    const dy = endY - shape.startY;
    if (shape.kind === "vector-circle") {
      const diameter = Math.max(Math.hypot(dx, dy) * 2, settings.gridMm);
      setItems((current) => current.map((item) => (item.id === shape.id ? { ...item, diameter } : item)));
      return;
    }
    if (shape.kind === "vector-rect") {
      const width = Math.max(Math.abs(dx), settings.gridMm);
      const height = Math.max(forceSquare ? Math.abs(dx) : Math.abs(dy), settings.gridMm);
      setItems((current) =>
        current.map((item) =>
          item.id === shape.id
            ? {
                ...item,
                x: shape.startX + Math.sign(dx || 1) * width * 0.5,
                y: shape.startY + Math.sign(dy || 1) * height * 0.5,
                width,
                height,
              }
            : item,
        ),
      );
      return;
    }
    setItems((current) =>
      current.map((item) =>
        item.id === shape.id
          ? {
              ...item,
              points: [
                { x: 0, y: 0 },
                { x: dx || settings.gridMm, y: dy },
              ],
            }
          : item,
      ),
    );
  }

  function addPathPoint(point: { x: number; y: number }) {
    const x = snap(point.x);
    const y = snap(point.y);
    if (activePathId) {
      const path = items.find((item) => item.id === activePathId && item.kind === "vector-path");
      if (path) {
        const points = path.points ?? [{ x: 0, y: 0 }];
        const closeDistance = points.length >= 3 ? Math.hypot(path.x + points[0].x - x, path.y + points[0].y - y) : Infinity;
        pushHistory();
        if (closeDistance <= PATH_CLOSE_DISTANCE_MM) {
          updateItem(activePathId, { closed: true }, false);
          setActivePathId(null);
          setTool("select");
          return;
        }
        updateItem(activePathId, { points: [...points, { x: x - path.x, y: y - path.y }] }, false);
        return;
      }
    }

    pushHistory();
    const id = crypto.randomUUID();
    const item: PanelItem = {
      id,
      kind: "vector-path",
      label: "Path",
      x,
      y,
      rotation: 0,
      opacity: 1,
      ...graphicDefaults(defaultGraphicLayer),
      strokeWidth: 0.24,
      points: [{ x: 0, y: 0 }],
      closed: false,
    };
    setItems((current) => [...current, item]);
    setSelection({ type: "item", id });
    setActivePathId(id);
  }

  function deleteSelection() {
    if (!selection) return;
    pushHistory();
    if (selection.type === "item") {
      setItems((current) => current.filter((item) => item.id !== selection.id));
    } else {
      setLayers((current) => current.filter((layer) => layer.id !== selection.id));
    }
    setSelection(null);
  }

  function copySelection() {
    if (!selectedItem) return;
    setCopiedItem(clonePanelItem(selectedItem));
  }

  function pasteCopiedItem() {
    if (!copiedItem) return;
    pushHistory();
    const offset = Math.max(settings.gridMm, 2);
    const item: PanelItem = {
      ...clonePanelItem(copiedItem),
      id: crypto.randomUUID(),
      label: copyLabel(copiedItem.label),
      x: snap(clamp(copiedItem.x + offset, 0, settings.widthMm)),
      y: snap(clamp(copiedItem.y + offset, 0, settings.heightMm)),
    };
    setItems((current) => [...current, item]);
    setSelection({ type: "item", id: item.id });
    setCopiedItem(clonePanelItem(item));
  }

  function resetProject() {
    pushHistory();
    setSettings(DEFAULT_PANEL);
    setItems([]);
    setLayers([]);
    setLayerColors(defaultObjectLayerColors);
    setSelection(null);
  }

  function resetSample() {
    pushHistory();
    setSettings(DEFAULT_PANEL);
    setItems(SAMPLE_ITEMS);
    setLayers(SAMPLE_LAYERS);
    setLayerColors(defaultObjectLayerColors);
    setSelection({ type: "item", id: SAMPLE_ITEMS[0].id });
    setView({ x: -54, y: -8, zoom: 4.2 });
  }

  function zoomBy(amount: number) {
    setView((current) => {
      const nextZoom = clamp(current.zoom + amount, MIN_ZOOM, MAX_ZOOM);
      const centerX = current.x + canvasSize.width / current.zoom / 2;
      const centerY = current.y + canvasSize.height / current.zoom / 2;
      return {
        x: centerX - canvasSize.width / nextZoom / 2,
        y: centerY - canvasSize.height / nextZoom / 2,
        zoom: nextZoom,
      };
    });
  }

  function fitPanel() {
    const padding = 18;
    const zoom = Math.min(canvasSize.width / (settings.widthMm + padding * 2), canvasSize.height / (settings.heightMm + padding * 2));
    setView({
      x: -padding,
      y: -padding,
      zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
    });
  }

  function snap(value: number) {
    return Math.round(value / settings.gridMm) * settings.gridMm;
  }

  function svgPointFromClient(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM()?.inverse();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  }

  function pointerPoint(event: React.PointerEvent<SVGSVGElement | SVGElement>) {
    return svgPointFromClient(event.clientX, event.clientY);
  }

  function localPointForItem(item: PanelItem, point: { x: number; y: number }) {
    const radians = -((item.rotation ?? 0) * Math.PI) / 180;
    const dx = point.x - item.x;
    const dy = point.y - item.y;
    return {
      x: snap(dx * Math.cos(radians) - dy * Math.sin(radians)),
      y: snap(dx * Math.sin(radians) + dy * Math.cos(radians)),
    };
  }

  function onCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const point = pointerPoint(event);
    if (tool === "vector-path") {
      addPathPoint(point);
      return;
    }
    if (tool === "vector-circle" || tool === "vector-rect" || tool === "vector-line") {
      beginShapeDraw(tool, point);
      return;
    }
    if (tool !== "select") {
      addItem(tool, point.x, point.y);
      return;
    }
    if (selection?.type === "layer" && layers.length > 0) {
      pushHistory();
      setDrag({
        type: "layer-group",
        startX: event.clientX,
        startY: event.clientY,
        offsets: layers.map((layer) => ({ id: layer.id, offsetX: layer.offsetX, offsetY: layer.offsetY })),
      });
      return;
    }
    setSelection(null);
    setDrag({
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      viewX: view.x,
      viewY: view.y,
    });
  }

  function onItemPointerDown(event: React.PointerEvent<SVGGElement>, item: PanelItem) {
    event.stopPropagation();
    const point = pointerPoint(event);
    if (tool === "vector-path") {
      addPathPoint(point);
      return;
    }
    if (tool === "vector-circle" || tool === "vector-rect" || tool === "vector-line") {
      beginShapeDraw(tool, point);
      return;
    }
    setSelection({ type: "item", id: item.id });
    dragHistoryCommittedRef.current = false;
    setDrag({
      type: "item",
      id: item.id,
      startX: point.x,
      startY: point.y,
      itemX: item.x,
      itemY: item.y,
    });
  }

  function onVectorPointPointerDown(event: React.PointerEvent<SVGElement>, item: PanelItem, pointIndex: number) {
    event.stopPropagation();
    if (tool === "vector-path") {
      addPathPoint(pointerPoint(event));
      return;
    }
    pushHistory();
    setSelection({ type: "item", id: item.id });
    setDrag({ type: "vector-point", id: item.id, pointIndex });
  }

  function onResizePointerDown(event: React.PointerEvent<SVGElement>, item: PanelItem) {
    event.stopPropagation();
    if (item.kind !== "artwork" && item.kind !== "vector-circle" && item.kind !== "vector-rect") return;
    pushHistory();
    setSelection({ type: "item", id: item.id });
    setDrag({ type: "resize", id: item.id, kind: item.kind });
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    if (drag.type === "pan") {
      const dx = (event.clientX - drag.startX) / view.zoom;
      const dy = (event.clientY - drag.startY) / view.zoom;
      setView((current) => ({ ...current, x: drag.viewX - dx, y: drag.viewY - dy }));
      return;
    }

    if (drag.type === "layer-group") {
      const dx = (event.clientX - drag.startX) / view.zoom;
      const dy = (event.clientY - drag.startY) / view.zoom;
      setLayers((current) =>
        current.map((layer) => {
          const start = drag.offsets.find((offset) => offset.id === layer.id);
          return start ? { ...layer, offsetX: start.offsetX + dx, offsetY: start.offsetY + dy } : layer;
        }),
      );
      return;
    }

    if (drag.type === "shape") {
      updateDrawnShape(drag, pointerPoint(event), event.shiftKey);
      return;
    }

    if (drag.type === "vector-point") {
      const item = items.find((entry) => entry.id === drag.id);
      if (!item) return;
      const points = [...(item.points ?? [])];
      if (!points[drag.pointIndex]) return;
      points[drag.pointIndex] = localPointForItem(item, pointerPoint(event));
      updateItem(drag.id, { points }, false);
      return;
    }

    if (drag.type === "resize") {
      const item = items.find((entry) => entry.id === drag.id);
      if (!item) return;
      const point = localPointForItem(item, pointerPoint(event));
      if (drag.kind === "vector-circle") {
        updateItem(drag.id, { diameter: Math.max(Math.hypot(point.x, point.y) * 2, settings.gridMm) }, false);
        return;
      }
      const width = Math.max(Math.abs(point.x) * 2, settings.gridMm);
      const height = Math.max((event.shiftKey ? Math.abs(point.x) : Math.abs(point.y)) * 2, settings.gridMm);
      updateItem(drag.id, { width, height }, false);
      return;
    }

    if (drag.type !== "item") return;
    const point = pointerPoint(event);
    if (!dragHistoryCommittedRef.current) {
      pushHistory();
      dragHistoryCommittedRef.current = true;
    }
    const nextX = snap(drag.itemX + point.x - drag.startX);
    const nextY = snap(drag.itemY + point.y - drag.startY);
    updateItem(drag.id, { x: nextX, y: nextY }, false);
  }

  async function importGerberFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = await expandGerberFiles([...fileList]);
    const imported: GerberLayer[] = [];
    for (const file of files) {
      const text = file.text;
      const name = file.name.toLowerCase();
      const kind = name.endsWith(".drl") || name.endsWith(".xln") || name.includes("drill") ? "drill" : name.endsWith(".dxf") ? "drawing" : "gerber";
      const primitives = kind === "drill" ? parseExcellon(text) : kind === "drawing" ? parseDxf(text) : parseGerber(text);
      const bounds = boundsForPrimitives(primitives);
      const layerNumber = layers.length + imported.length;
      imported.push({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        kind,
        color: LAYER_COLORS[layerNumber % LAYER_COLORS.length],
        opacity: kind === "drill" ? 0.72 : 0.44,
        visible: true,
        offsetX: bounds ? settings.widthMm / 2 - (bounds.minX + bounds.maxX) / 2 : 0,
        offsetY: bounds ? settings.heightMm / 2 - (bounds.minY + bounds.maxY) / 2 : 0,
        rotation: 0,
        mirrorX: false,
        primitives,
        bounds,
      });
    }
    if (!imported.length) return;
    pushHistory();
    setLayers((current) => [...current, ...imported]);
    if (imported[0]) setSelection({ type: "layer", id: imported[0].id });
  }

  async function importArtworkFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    pushHistory();
    const files = [...fileList];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".dxf")) {
        const text = await file.text();
        const primitives = parseDxf(text);
        const bounds = boundsForPrimitives(primitives);
        const id = crypto.randomUUID();
        setLayers((current) => [
          ...current,
          {
            id,
            name: file.name.replace(/\.[^.]+$/, ""),
            fileName: file.name,
            kind: "drawing",
            color: LAYER_COLORS[current.length % LAYER_COLORS.length],
            opacity: 0.55,
            visible: true,
            offsetX: bounds ? settings.widthMm / 2 - (bounds.minX + bounds.maxX) / 2 : 0,
            offsetY: bounds ? settings.heightMm / 2 - (bounds.minY + bounds.maxY) / 2 : 0,
            rotation: 0,
            mirrorX: false,
            primitives,
            bounds,
          },
        ]);
        setSelection({ type: "layer", id });
        continue;
      }

      const dataUrl = await readAsDataUrl(file);
      const id = crypto.randomUUID();
      const trace = lower.endsWith(".svg") ? null : await traceImageToArtwork(dataUrl).catch(() => null);
      const width = lower.endsWith(".svg") ? 28 : 24;
      const height = trace ? width * (trace.sourceHeight / trace.sourceWidth) : width;
      const item: PanelItem = {
        id,
        kind: "artwork",
        label: file.name.replace(/\.[^.]+$/, ""),
        x: settings.widthMm / 2,
        y: settings.heightMm / 2,
        width,
        height,
        rotation: 0,
        imageUrl: dataUrl,
        fileName: file.name,
        artworkTrace: trace ?? undefined,
        filled: Boolean(trace),
        opacity: 1,
        ...graphicDefaults(defaultGraphicLayer),
      };
      setItems((current) => [...current, item]);
      setSelection({ type: "item", id });
    }
  }

  async function retraceArtwork(id: string, options: TraceImageOptions) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.kind !== "artwork" || !item.imageUrl || item.imageUrl.startsWith("data:image/svg")) return;
    const currentTrace = item.artworkTrace;
    const trace = await traceImageToArtwork(item.imageUrl, {
      mode: options.mode ?? currentTrace?.requestedMode ?? traceModeFromResult(currentTrace?.mode),
      threshold: options.threshold ?? currentTrace?.threshold ?? 154,
      detail: options.detail ?? currentTrace?.detail ?? 128,
    }).catch(() => null);
    if (!trace) return;
    pushHistory();
    setItems((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              artworkTrace: trace,
              filled: true,
            }
          : entry,
      ),
    );
  }

  async function importProject(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    const parsed = JSON.parse(await file.text()) as {
      settings: PanelSettings;
      items: PanelItem[];
      layers: GerberLayer[];
      layerColors?: Record<GerberTargetLayer, string>;
    };
    pushHistory();
    setSettings(parsed.settings);
    setItems(parsed.items ?? []);
    setLayers(parsed.layers ?? []);
    setLayerColors({ ...defaultObjectLayerColors, ...(parsed.layerColors ?? {}) });
    setSelection(null);
  }

  function exportProject() {
    downloadText(
      "eurorack-panel-project.json",
      JSON.stringify(
        {
          settings,
          items,
          layers,
          layerColors,
        },
        null,
        2,
      ),
      "application/json",
    );
  }

  function exportSvg() {
    downloadText("eurorack-panel.svg", createSvg(settings, items), "image/svg+xml");
  }

  function exportDxf() {
    downloadText("eurorack-panel.dxf", createDxf(settings, items), "application/dxf");
  }

  function exportGerbers() {
    const files = [
      { name: "eurorack-panel-Edge_Cuts.gbr", text: createGerberOutline(settings), mime: "application/x-gerber" },
      { name: "eurorack-panel-F_Mask.gbr", text: createGerberGraphicLayer(settings, items, "frontMask"), mime: "application/x-gerber" },
      { name: "eurorack-panel-F_Silk.gbr", text: createGerberGraphicLayer(settings, items, "frontSilk"), mime: "application/x-gerber" },
      { name: "eurorack-panel-F_Cu.gbr", text: createGerberGraphicLayer(settings, items, "frontCopper"), mime: "application/x-gerber" },
      { name: "eurorack-panel-B_Mask.gbr", text: createGerberGraphicLayer(settings, items, "backMask"), mime: "application/x-gerber" },
      { name: "eurorack-panel-B_Silk.gbr", text: createGerberGraphicLayer(settings, items, "backSilk"), mime: "application/x-gerber" },
      { name: "eurorack-panel-B_Cu.gbr", text: createGerberGraphicLayer(settings, items, "backCopper"), mime: "application/x-gerber" },
      { name: "eurorack-panel.drl", text: createDrill(settings, items), mime: "application/x-excellon" },
    ];
    files.forEach((file, index) => {
      window.setTimeout(() => downloadText(file.name, file.text, file.mime), index * 130);
    });
  }

  function exportStl() {
    downloadText("eurorack-panel.stl", createStl(settings, items), "model/stl");
  }

  return (
    <div className="app-shell">
      <input
        ref={gerberInputRef}
        type="file"
        multiple
        className="hidden-input"
        accept=".zip,.gbr,.ger,.gtl,.gbl,.gto,.gbo,.gm1,.gko,.drl,.xln,.txt,.dxf"
        onChange={(event) => {
          void importGerberFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={artworkInputRef}
        type="file"
        multiple
        className="hidden-input"
        accept=".png,.jpg,.jpeg,.webp,.svg,.dxf"
        onChange={(event) => {
          void importArtworkFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        className="hidden-input"
        accept=".json"
        onChange={(event) => {
          void importProject(event.target.files);
          event.currentTarget.value = "";
        }}
      />

      <header className="topbar">
        <div className="brand">
          <Hexagon size={21} />
          <div>
            <strong>Panel Bench</strong>
            <span>{settings.hp}HP Eurorack</span>
          </div>
        </div>
        <div className="toolbar-group">
          <IconButton label="Import Gerbers" onClick={() => gerberInputRef.current?.click()} icon={Upload} text="Gerbers" />
          <IconButton label="Import artwork" onClick={() => artworkInputRef.current?.click()} icon={FileImage} text="Artwork" />
          <IconButton label="Load project" onClick={() => projectInputRef.current?.click()} icon={FolderOpen} />
          <IconButton label="Save project" onClick={exportProject} icon={Save} />
          <IconButton label="Undo" onClick={undo} icon={Undo2} disabled={!canUndo} />
          <IconButton label="Redo" onClick={redo} icon={Redo2} disabled={!canRedo} />
        </div>
        <div className="toolbar-group tool-palette">
          {toolOptions.map((option) => (
            <IconButton
              key={option.mode}
              label={option.label}
              onClick={() => setTool(option.mode)}
              icon={option.icon}
              active={tool === option.mode}
            />
          ))}
        </div>
        <div className="toolbar-group">
          <IconButton label="Zoom out" onClick={() => zoomBy(-0.5)} icon={ZoomOut} />
          <IconButton label="Fit panel" onClick={fitPanel} icon={AlignCenter} />
          <IconButton label="Zoom in" onClick={() => zoomBy(0.5)} icon={ZoomIn} />
          <div className="zoom-readout">{Math.round(view.zoom * 20)}%</div>
        </div>
        <div className="toolbar-group export-group">
          <IconButton label="3D preview" onClick={() => setShowPreview(true)} icon={Box} text="3D" />
          <IconButton label="Export SVG" onClick={exportSvg} icon={Image} text="SVG" />
          <IconButton label="Export DXF" onClick={exportDxf} icon={Ruler} text="DXF" />
          <IconButton label="Export Gerber and drill" onClick={exportGerbers} icon={FileDown} text="GBR" />
          <IconButton label="Export STL" onClick={exportStl} icon={Download} text="STL" />
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar left-panel">
          <PanelBlock title="Imports">
            <div className="quick-actions">
              <button type="button" onClick={() => gerberInputRef.current?.click()}>
                <Upload size={16} />
                Gerber set
              </button>
              <button type="button" onClick={() => artworkInputRef.current?.click()}>
                <FileImage size={16} />
                Image/SVG/DXF
              </button>
            </div>
          </PanelBlock>

          <PanelBlock title="New Art">
            <SelectField
              label="New layer"
              value={defaultGraphicLayer}
              options={newGraphicLayerOptions}
              onChange={(gerberLayer) => setDefaultGraphicLayer(gerberLayer as GerberTargetLayer)}
            />
          </PanelBlock>

          <PanelBlock title="Layers" action={<Layers size={16} />}>
            <div className="layer-list">
              {layers.map((layer) => (
                <button
                  type="button"
                  key={layer.id}
                  className={`layer-row ${selection?.type === "layer" && selection.id === layer.id ? "selected" : ""}`}
                  onClick={() => setSelection({ type: "layer", id: layer.id })}
                >
                  <span className="layer-swatch" style={{ background: layer.color }} />
                  <span className="layer-main">
                    <strong>{layer.name}</strong>
                    <span>
                      {layer.kind} · {layer.primitives.length} shapes
                    </span>
                  </span>
                  <input
                    aria-label={`${layer.name} visible`}
                    type="checkbox"
                    checked={layer.visible}
                    onChange={(event) => {
                      event.stopPropagation();
                      updateLayer(layer.id, { visible: event.target.checked });
                    }}
                  />
                </button>
              ))}
              {!layers.length && <div className="empty-state">No layers</div>}
            </div>
          </PanelBlock>

          <PanelBlock title="Panel Objects">
            <div className="object-list layered-object-list">
              {items.length ? (
                objectLayerSections.map((section) => {
                  const sectionItems = items.filter((item) => objectListLayer(item) === section.value);
                  const collapsed = collapsedObjectLayers.includes(section.value);
                  const DisclosureIcon = collapsed ? ChevronRight : ChevronDown;
                  return (
                    <div
                      key={section.value}
                      className={`object-layer-group ${collapsed ? "collapsed" : ""}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const id = event.dataTransfer.getData("text/panel-object-id") || event.dataTransfer.getData("text/plain");
                        if (id) assignItemLayer(id, section.value);
                      }}
                    >
                      <button
                        type="button"
                        className="object-layer-heading"
                        aria-expanded={!collapsed}
                        aria-controls={`object-layer-${section.value}`}
                        onClick={() => toggleObjectLayer(section.value)}
                      >
                        <DisclosureIcon size={12} />
                        <input
                          aria-label={`${section.label} color`}
                          type="color"
                          value={layerColors[section.value]}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => updateObjectLayerColor(section.value, event.target.value)}
                        />
                        <strong>{section.label}</strong>
                        <small>{sectionItems.length}</small>
                      </button>
                      <div className="layer-color-presets" aria-label={`${section.label} material colors`}>
                        {materialPalette.map((preset) => (
                          <button
                            type="button"
                            key={`${section.value}-${preset.label}`}
                            title={preset.label}
                            aria-label={`${section.label} ${preset.label}`}
                            className={layerColors[section.value].toLowerCase() === preset.color.toLowerCase() ? "active" : ""}
                            style={{ background: preset.color }}
                            onClick={() => updateObjectLayerColor(section.value, preset.color)}
                          />
                        ))}
                      </div>
                      {!collapsed && (
                        <div id={`object-layer-${section.value}`} className="object-layer-items">
                          {sectionItems.map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              draggable={isGraphicItem(item)}
                              className={`object-row ${selection?.type === "item" && selection.id === item.id ? "selected" : ""}`}
                              onClick={() => setSelection({ type: "item", id: item.id })}
                              onDragStart={(event) => {
                                event.dataTransfer.setData("text/panel-object-id", item.id);
                                event.dataTransfer.setData("text/plain", item.id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                            >
                              {iconForItem(item.kind)}
                              <span>
                                <strong>{item.label}</strong>
                                <small>
                                  {round(item.x)} / {round(item.y)} mm
                                </small>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">No objects</div>
              )}
            </div>
          </PanelBlock>
        </aside>

        <section className="canvas-column">
          <div className="canvas-meta">
            <div>
              <strong>{round(settings.widthMm)} x {round(settings.heightMm)} mm</strong>
              <span>{holes.length} holes · {settings.gridMm} mm grid</span>
            </div>
            <div className="canvas-tools">
              <IconButton label="Pan canvas" onClick={() => setTool("select")} icon={Hand} active={tool === "select"} />
              <IconButton label="Grid snap" onClick={() => updatePanel({ gridMm: settings.gridMm === 2.54 ? 1 : 2.54 })} icon={Grid2X2} text={`${settings.gridMm}`} />
              <IconButton label="Undo" onClick={undo} icon={Undo2} disabled={!canUndo} />
              <IconButton label="Redo" onClick={redo} icon={Redo2} disabled={!canRedo} />
              <IconButton label="Copy selected" onClick={copySelection} icon={Copy} disabled={!selectedItem} />
              <IconButton label="Paste object" onClick={pasteCopiedItem} icon={ClipboardPaste} disabled={!copiedItem} />
              <IconButton label="Delete selected" onClick={deleteSelection} icon={Trash2} disabled={!selection} />
              <IconButton label="Reset sample" onClick={resetSample} icon={RefreshCcw} />
              <IconButton label="New panel" onClick={resetProject} icon={Trash2} />
            </div>
          </div>

          <div ref={canvasRef} className="canvas-frame">
            <svg
              ref={svgRef}
              className="panel-canvas"
              viewBox={viewBox}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => {
                if (drag?.type === "shape") setTool("select");
                dragHistoryCommittedRef.current = false;
                setDrag(null);
              }}
              onPointerLeave={() => {
                if (drag?.type === "shape") setTool("select");
                dragHistoryCommittedRef.current = false;
                setDrag(null);
              }}
            >
              <defs>
                <pattern id="minor-grid" width={settings.gridMm} height={settings.gridMm} patternUnits="userSpaceOnUse">
                  <path d={`M ${settings.gridMm} 0 L 0 0 0 ${settings.gridMm}`} fill="none" stroke="#d7dee8" strokeWidth="0.08" />
                </pattern>
                <pattern id="major-grid" width={settings.gridMm * 4} height={settings.gridMm * 4} patternUnits="userSpaceOnUse">
                  <path d={`M ${settings.gridMm * 4} 0 L 0 0 0 ${settings.gridMm * 4}`} fill="none" stroke="#bcc8d7" strokeWidth="0.14" />
                </pattern>
                <filter id="soft-panel-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1.4" stdDeviation="1.2" floodColor="#0f172a" floodOpacity="0.16" />
                </filter>
              </defs>
              <rect x={view.x - 60} y={view.y - 60} width={canvasSize.width / view.zoom + 120} height={canvasSize.height / view.zoom + 120} fill="#eef2f6" />
              <rect x={view.x - 60} y={view.y - 60} width={canvasSize.width / view.zoom + 120} height={canvasSize.height / view.zoom + 120} fill="url(#minor-grid)" />
              <rect x={view.x - 60} y={view.y - 60} width={canvasSize.width / view.zoom + 120} height={canvasSize.height / view.zoom + 120} fill="url(#major-grid)" />
              <Rulers settings={settings} view={view} canvasSize={canvasSize} />
              <g filter="url(#soft-panel-shadow)">
                <rect x="0" y="0" width={settings.widthMm} height={settings.heightMm} rx="1.35" fill="#fafafa" stroke="#0f172a" strokeWidth="0.22" />
              </g>
              <rect x="0" y="0" width={settings.widthMm} height={settings.heightMm} rx="1.35" fill="#ffffff" opacity="0.84" />
              {settings.showPcbArea !== false && <PcbAreaOverlay settings={settings} />}

              <g className="gerber-layers" pointerEvents="none">
                {layers.filter((layer) => layer.visible).map((layer) => (
                  <LayerView key={layer.id} layer={layer} />
                ))}
              </g>

              <g className="mounting-holes">
                {settings.showMountingHoles &&
                  panelHoles(settings, []).map((hole) => (
                    <g key={`${hole.x}-${hole.y}`} className="mount-hole">
                      <circle cx={hole.x} cy={hole.y} r={hole.diameter / 2} fill="#f8fafc" stroke="#64748b" strokeWidth="0.18" strokeDasharray="0.9 0.55" />
                      <line x1={hole.x - 2.5} y1={hole.y} x2={hole.x + 2.5} y2={hole.y} stroke="#64748b" strokeWidth="0.12" />
                      <line x1={hole.x} y1={hole.y - 2.5} x2={hole.x} y2={hole.y + 2.5} stroke="#64748b" strokeWidth="0.12" />
                    </g>
                  ))}
              </g>

              <g className="panel-items">
                {[...items.filter(isGraphicItem), ...items.filter((item) => !isGraphicItem(item))].map((item) => (
                  <ItemView
                    key={item.id}
                    item={item}
                    selected={selection?.type === "item" && selection.id === item.id}
                    layerColors={layerColors}
                    onPointerDown={(event) => onItemPointerDown(event, item)}
                    onPointPointerDown={onVectorPointPointerDown}
                    onResizePointerDown={onResizePointerDown}
                  />
                ))}
              </g>

              <rect x="0" y="0" width={settings.widthMm} height={settings.heightMm} rx="1.35" fill="none" stroke="#0f172a" strokeWidth="0.26" pointerEvents="none" />
            </svg>
          </div>

          <footer className="statusbar">
            <span>Tool: {tool}</span>
            <span>Zoom: {round(view.zoom)} px/mm</span>
            <span>
              Selected: {selectedItem?.label ?? selectedLayer?.name ?? "none"}
            </span>
          </footer>
        </section>

        <aside className="sidebar right-panel">
          <PanelInspector settings={settings} updatePanel={updatePanel} />
          {selectedItem && (
            <ItemInspector
              item={selectedItem}
              updateItem={(patch) => updateItem(selectedItem.id, patch)}
              onTraceChange={(options) => void retraceArtwork(selectedItem.id, options)}
              onDelete={deleteSelection}
            />
          )}
          {selectedLayer && <LayerInspector layer={selectedLayer} updateLayer={(patch) => updateLayer(selectedLayer.id, patch)} onDelete={deleteSelection} />}
          {!selectedItem && !selectedLayer && (
            <PanelBlock title="Selection">
              <div className="empty-state">Nothing selected</div>
            </PanelBlock>
          )}
        </aside>
      </main>
      {showPreview && (
        <PanelPreviewDialog settings={settings} items={items} layerColors={layerColors} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}

function PanelInspector({
  settings,
  updatePanel,
}: {
  settings: PanelSettings;
  updatePanel: (patch: Partial<PanelSettings>) => void;
}) {
  return (
    <PanelBlock title="Panel">
      <NumberField label="HP" value={settings.hp} step={1} min={2} onChange={(hp) => updatePanel({ hp })} />
      <NumberField label="Width" value={settings.widthMm} step={0.01} onChange={(widthMm) => updatePanel({ widthMm, hp: round(widthMm / 5.08) })} suffix="mm" />
      <NumberField label="Height" value={settings.heightMm} step={0.1} onChange={(heightMm) => updatePanel({ heightMm })} suffix="mm" />
      <NumberField label="Thickness" value={settings.thicknessMm} step={0.1} min={0.4} onChange={(thicknessMm) => updatePanel({ thicknessMm })} suffix="mm" />
      <NumberField label="Grid" value={settings.gridMm} step={0.01} min={0.1} onChange={(gridMm) => updatePanel({ gridMm })} suffix="mm" />
      <label className="toggle-row">
        <input type="checkbox" checked={settings.showMountingHoles} onChange={(event) => updatePanel({ showMountingHoles: event.target.checked })} />
        Mount holes
      </label>
      <NumberField label="Mount dia" value={settings.mountHoleDiameter} step={0.1} min={0.5} onChange={(mountHoleDiameter) => updatePanel({ mountHoleDiameter })} suffix="mm" />
      <NumberField label="Mount X" value={settings.mountHoleInsetX} step={0.1} min={0} onChange={(mountHoleInsetX) => updatePanel({ mountHoleInsetX })} suffix="mm" />
      <NumberField label="Mount Y" value={settings.mountHoleInsetY} step={0.1} min={0} onChange={(mountHoleInsetY) => updatePanel({ mountHoleInsetY })} suffix="mm" />
      <label className="toggle-row">
        <input type="checkbox" checked={settings.showPcbArea !== false} onChange={(event) => updatePanel({ showPcbArea: event.target.checked })} />
        PCB area
      </label>
      <NumberField label="PCB X" value={settings.pcbInsetX ?? 5} step={0.1} min={0} onChange={(pcbInsetX) => updatePanel({ pcbInsetX })} suffix="mm" />
      <NumberField label="PCB Y" value={settings.pcbInsetY ?? 8} step={0.1} min={0} onChange={(pcbInsetY) => updatePanel({ pcbInsetY })} suffix="mm" />
    </PanelBlock>
  );
}

function PanelPreviewDialog({
  settings,
  items,
  layerColors,
  onClose,
}: {
  settings: PanelSettings;
  items: PanelItem[];
  layerColors: Record<GerberTargetLayer, string>;
  onClose: () => void;
}) {
  const [view, setView] = useState<PreviewView>({ angle: 0, tilt: 24, zoom: 1 });
  const resetView = () => setView({ angle: 0, tilt: 24, zoom: 1 });
  const setTopView = () => setView({ angle: 0, tilt: 0, zoom: 1.08 });
  const setIsoView = () => setView({ angle: 36, tilt: 42, zoom: 0.96 });

  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-label="3D preview" onPointerDown={onClose}>
      <section className="preview-dialog" onPointerDown={(event) => event.stopPropagation()}>
        <div className="preview-header">
          <div>
            <strong>3D preview</strong>
            <span>
              {round(settings.widthMm)} x {round(settings.heightMm)} mm
            </span>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="preview-controls">
          <button type="button" onClick={setTopView}>
            Top
          </button>
          <button type="button" onClick={setIsoView}>
            Iso
          </button>
          <button type="button" onClick={resetView}>
            Reset
          </button>
          <label>
            <span>Angle</span>
            <input
              aria-label="Preview angle"
              type="range"
              min="-180"
              max="180"
              step="1"
              value={view.angle}
              onChange={(event) => setView((current) => ({ ...current, angle: Number(event.target.value) }))}
            />
            <output>{Math.round(view.angle)} deg</output>
          </label>
          <label>
            <span>Tilt</span>
            <input
              aria-label="Preview tilt"
              type="range"
              min="0"
              max="68"
              step="1"
              value={view.tilt}
              onChange={(event) => setView((current) => ({ ...current, tilt: Number(event.target.value) }))}
            />
            <output>{Math.round(view.tilt)} deg</output>
          </label>
          <label>
            <span>Zoom</span>
            <input
              aria-label="Preview zoom"
              type="range"
              min="0.7"
              max="1.6"
              step="0.02"
              value={view.zoom}
              onChange={(event) => setView((current) => ({ ...current, zoom: Number(event.target.value) }))}
            />
            <output>{view.zoom.toFixed(2)}x</output>
          </label>
        </div>
        <div className="preview-scene">
          <PanelThreePreview settings={settings} items={items} layerColors={layerColors} view={view} onViewChange={setView} />
        </div>
      </section>
    </div>
  );
}

function PanelThreePreview({
  settings,
  items,
  layerColors,
  view,
  onViewChange,
}: {
  settings: PanelSettings;
  items: PanelItem[];
  layerColors: Record<GerberTargetLayer, string>;
  view: PreviewView;
  onViewChange: Dispatch<SetStateAction<PreviewView>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef(view);
  const renderRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  viewRef.current = view;

  useEffect(() => {
    viewRef.current = view;
    renderRef.current?.();
  }, [view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetCanvas = canvas;

    const renderer = new THREE.WebGLRenderer({ canvas: targetCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
    const group = new THREE.Group();
    group.position.set(-settings.widthMm / 2, settings.heightMm / 2, -settings.thicknessMm / 2);
    group.scale.set(1, -1, 1);
    scene.add(group);

    const cutouts = threeCutoutShapes(settings, items);
    const maxRelief = Math.max(
      0.08,
      ...items.filter((item) => isGraphicItem(item) && (item.stlMode ?? "raised") === "raised").map((item) => Math.max(item.reliefHeight ?? 0.4, 0.04)),
    );
    const panelShape = createPanelThreeShape(settings, cutouts);
    const panelGeometry = new THREE.ExtrudeGeometry(panelShape, {
      depth: settings.thicknessMm,
      bevelEnabled: true,
      bevelThickness: 0.18,
      bevelSize: 0.18,
      bevelSegments: 2,
      curveSegments: 48,
    });
    const panelMaterial = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.68, metalness: 0.02 });
    const panelMesh = new THREE.Mesh(panelGeometry, panelMaterial);
    panelMesh.castShadow = true;
    panelMesh.receiveShadow = true;
    group.add(panelMesh);
    addThreeLine(
      group,
      [
        { x: 0, y: 0 },
        { x: settings.widthMm, y: 0 },
        { x: settings.widthMm, y: settings.heightMm },
        { x: 0, y: settings.heightMm },
      ],
      "#64748b",
      settings.thicknessMm + 0.1,
      true,
    );

    if (settings.showPcbArea !== false) {
      const area = pcbArea(settings);
      const pcbMaterial = new THREE.MeshBasicMaterial({ color: "#64748b", transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
      const pcbMesh = new THREE.Mesh(new THREE.PlaneGeometry(area.width, area.height), pcbMaterial);
      pcbMesh.position.set(area.x + area.width / 2, area.y + area.height / 2, settings.thicknessMm + 0.12);
      group.add(pcbMesh);
      addThreeLine(
        group,
        [
          { x: area.x, y: area.y },
          { x: area.x + area.width, y: area.y },
          { x: area.x + area.width, y: area.y + area.height },
          { x: area.x, y: area.y + area.height },
        ],
        "#64748b",
        settings.thicknessMm + 0.2,
        true,
      );
    }

    for (const item of items.filter((entry) => isGraphicItem(entry) && entry.stlMode !== "cutout")) {
      addThreeGraphic(group, item, layerColors, settings.thicknessMm, cutouts);
    }

    for (const cutout of cutouts) {
      addThreeCutoutDepth(group, cutout, settings.thicknessMm, maxRelief);
      if (cutout.kind === "graphic") addThreeCutoutCue(group, cutout.shape, settings.thicknessMm + maxRelief + 0.12);
    }

    const hemi = new THREE.HemisphereLight("#ffffff", "#aab4c2", 2.6);
    scene.add(hemi);
    const key = new THREE.DirectionalLight("#ffffff", 2.9);
    key.position.set(settings.widthMm * 0.7, -settings.heightMm * 0.9, settings.heightMm * 0.9);
    key.castShadow = true;
    scene.add(key);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(settings.widthMm * 4, settings.heightMm * 3), new THREE.ShadowMaterial({ opacity: 0.18 }));
    floor.position.set(0, 0, -settings.thicknessMm * 1.5);
    floor.receiveShadow = true;
    scene.add(floor);

    const center = new THREE.Vector3(0, 0, settings.thicknessMm / 3);
    function render() {
      const width = Math.max(targetCanvas.clientWidth, 320);
      const height = Math.max(targetCanvas.clientHeight, 320);
      renderer.setSize(width, height, false);
      const preview = viewRef.current;
      const aspect = width / height;
      const fitSpan = Math.max(settings.heightMm, settings.widthMm / aspect) * 1.2;
      const distance = fitSpan / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * preview.zoom);
      camera.aspect = aspect;
      const tilt = THREE.MathUtils.degToRad(clamp(preview.tilt, 0, 72));
      const angle = THREE.MathUtils.degToRad(preview.angle);
      const planarDistance = Math.sin(tilt) * distance;
      camera.position.set(Math.sin(angle) * planarDistance, -Math.cos(angle) * planarDistance, Math.cos(tilt) * distance + settings.thicknessMm * 2);
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }

    render();
    renderRef.current = render;
    const observer = new ResizeObserver(render);
    observer.observe(targetCanvas);

    return () => {
      observer.disconnect();
      renderRef.current = null;
      panelGeometry.dispose();
      renderer.dispose();
      scene.traverse((object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach(disposeThreeMaterial);
          } else {
            disposeThreeMaterial(object.material);
          }
        }
      });
    };
  }, [settings, items, layerColors]);

  return (
    <canvas
      ref={canvasRef}
      className="three-preview-canvas"
      aria-label="3D panel render"
      onPointerDown={(event) => {
        dragRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        const dx = event.clientX - dragRef.current.x;
        const dy = event.clientY - dragRef.current.y;
        dragRef.current = { x: event.clientX, y: event.clientY };
        onViewChange((current) => ({
          ...current,
          angle: wrapAngle(current.angle + dx * 0.45),
          tilt: clamp(current.tilt - dy * 0.28, 0, 68),
        }));
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerLeave={() => {
        dragRef.current = null;
      }}
      onWheel={(event) => {
        event.preventDefault();
        onViewChange((current) => ({ ...current, zoom: clamp(current.zoom + (event.deltaY < 0 ? 0.08 : -0.08), 0.7, 1.6) }));
      }}
    />
  );
}

function PcbAreaOverlay({ settings }: { settings: PanelSettings }) {
  const area = pcbArea(settings);
  return (
    <rect
      className="pcb-area-overlay"
      x={area.x}
      y={area.y}
      width={area.width}
      height={area.height}
      rx="0.8"
      fill="#64748b"
      fillOpacity="0.14"
      stroke="#64748b"
      strokeWidth="0.16"
      strokeDasharray="1 0.7"
      pointerEvents="none"
    />
  );
}

function ItemInspector({
  item,
  updateItem,
  onTraceChange,
  onDelete,
}: {
  item: PanelItem;
  updateItem: (patch: Partial<PanelItem>) => void;
  onTraceChange?: (options: TraceImageOptions) => void;
  onDelete: () => void;
}) {
  const traceableArtwork = item.kind === "artwork" && Boolean(item.imageUrl) && !item.imageUrl?.startsWith("data:image/svg");
  const traceMode = item.artworkTrace?.requestedMode ?? traceModeFromResult(item.artworkTrace?.mode);
  const traceThreshold = item.artworkTrace?.threshold ?? 154;
  const traceDetail = item.artworkTrace?.detail ?? 128;
  const applyTraceOptions = (patch: TraceImageOptions = {}) =>
    onTraceChange?.({
      mode: traceMode,
      threshold: traceThreshold,
      detail: traceDetail,
      ...patch,
    });

  return (
    <PanelBlock title="Object">
      <TextField label="Name" value={item.label} onChange={(label) => updateItem({ label })} />
      <NumberField label="X" value={item.x} step={0.1} onChange={(x) => updateItem({ x })} suffix="mm" />
      <NumberField label="Y" value={item.y} step={0.1} onChange={(y) => updateItem({ y })} suffix="mm" />
      {(item.kind === "pot" || item.kind === "jack" || item.kind === "hole") && (
        <>
          {item.kind === "hole" && (
            <SelectField
              label="Preset"
              value={holePresetValue(item.diameter ?? 3.2)}
              options={holePresetOptions}
              onChange={(value) => {
                if (value === "custom") return;
                const preset = holePresetOptions.find((option) => option.value === value);
                updateItem({
                  diameter: Number(value),
                  label: item.label === "Hole" && preset ? preset.label.replace(" mm", "") : item.label,
                });
              }}
            />
          )}
          <NumberField label="Diameter" value={item.diameter ?? 3.2} step={0.1} min={0.1} onChange={(diameter) => updateItem({ diameter })} suffix="mm" />
        </>
      )}
      {item.kind === "text" && (
        <>
          <TextField label="Text" value={item.text ?? ""} onChange={(text) => updateItem({ text })} />
          <FontPicker value={item.fontFamily ?? fontOptions[0].value} onChange={(fontFamily) => updateItem({ fontFamily })} />
          <NumberField label="Size" value={item.fontSize ?? 4} step={0.1} min={0.4} onChange={(fontSize) => updateItem({ fontSize })} suffix="mm" />
          <NumberField label="Rotate" value={item.rotation ?? 0} step={1} onChange={(rotation) => updateItem({ rotation })} suffix="deg" />
          <label className="toggle-row">
            <input type="checkbox" checked={(item.fontWeight ?? 720) >= 700} onChange={(event) => updateItem({ fontWeight: event.target.checked ? 760 : 400 })} />
            Bold
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={(item.fontStyle ?? "normal") === "italic"} onChange={(event) => updateItem({ fontStyle: event.target.checked ? "italic" : "normal" })} />
            Italic
          </label>
        </>
      )}
      {item.kind === "artwork" && (
        <>
          <NumberField label="Width" value={item.width ?? 20} step={0.1} min={0.1} onChange={(width) => updateItem({ width })} suffix="mm" />
          <NumberField label="Height" value={item.height ?? 20} step={0.1} min={0.1} onChange={(height) => updateItem({ height })} suffix="mm" />
          <NumberField label="Rotate" value={item.rotation ?? 0} step={1} onChange={(rotation) => updateItem({ rotation })} suffix="deg" />
          <NumberField label="Opacity" value={item.opacity ?? 1} step={0.05} min={0.05} max={1} onChange={(opacity) => updateItem({ opacity })} />
          {traceableArtwork && (
            <>
              <SelectField label="Trace mode" value={traceMode} options={traceModeOptions} onChange={(mode) => applyTraceOptions({ mode: mode as TraceMode })} />
              <NumberField label="Trace threshold" value={traceThreshold} step={1} min={0} max={255} onChange={(threshold) => applyTraceOptions({ threshold })} />
              <SelectField label="Trace detail" value={String(traceDetail)} options={traceDetailOptions} onChange={(detail) => applyTraceOptions({ detail: Number(detail) })} />
              <button type="button" className="secondary-action" onClick={() => applyTraceOptions()}>
                <RefreshCcw size={14} />
                Retrace image
              </button>
            </>
          )}
          {hasArtworkTrace(item) && (
            <div className="trace-summary">
              Vector trace - {item.artworkTrace!.paths.length} shapes - {traceModeLabel(traceMode)} - {item.artworkTrace!.gridWidth}x{item.artworkTrace!.gridHeight}
            </div>
          )}
          {traceableArtwork && !hasArtworkTrace(item) && <div className="trace-summary muted">No vector trace yet</div>}
        </>
      )}
      {item.kind === "vector-circle" && (
        <>
          <NumberField label="Diameter" value={item.diameter ?? 8} step={0.1} min={0.1} onChange={(diameter) => updateItem({ diameter })} suffix="mm" />
          <NumberField label="Stroke" value={item.strokeWidth ?? 0.24} step={0.05} min={0.05} onChange={(strokeWidth) => updateItem({ strokeWidth })} suffix="mm" />
          <label className="toggle-row">
            <input type="checkbox" checked={item.filled ?? false} onChange={(event) => updateItem({ filled: event.target.checked })} />
            Fill
          </label>
        </>
      )}
      {item.kind === "vector-rect" && (
        <>
          <NumberField label="Width" value={item.width ?? 12} step={0.1} min={0.1} onChange={(width) => updateItem({ width })} suffix="mm" />
          <NumberField label="Height" value={item.height ?? 8} step={0.1} min={0.1} onChange={(height) => updateItem({ height })} suffix="mm" />
          <NumberField label="Rotate" value={item.rotation ?? 0} step={1} onChange={(rotation) => updateItem({ rotation })} suffix="deg" />
          <NumberField label="Stroke" value={item.strokeWidth ?? 0.24} step={0.05} min={0.05} onChange={(strokeWidth) => updateItem({ strokeWidth })} suffix="mm" />
          <label className="toggle-row">
            <input type="checkbox" checked={item.filled ?? false} onChange={(event) => updateItem({ filled: event.target.checked })} />
            Fill
          </label>
        </>
      )}
      {(item.kind === "vector-line" || item.kind === "vector-path") && (
        <>
          <NumberField label="Rotate" value={item.rotation ?? 0} step={1} onChange={(rotation) => updateItem({ rotation })} suffix="deg" />
          <NumberField label="Stroke" value={item.strokeWidth ?? 0.24} step={0.05} min={0.05} onChange={(strokeWidth) => updateItem({ strokeWidth })} suffix="mm" />
          {item.kind === "vector-path" && (
            <>
              <label className="toggle-row">
                <input type="checkbox" checked={item.closed ?? false} onChange={(event) => updateItem({ closed: event.target.checked })} />
                Closed
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={item.filled ?? false} onChange={(event) => updateItem({ filled: event.target.checked })} />
                Fill
              </label>
            </>
          )}
        </>
      )}
      {isGraphicItem(item) && (
        <>
          <SelectField
            label="3D"
            value={item.stlMode ?? "raised"}
            options={stlModeOptions}
            onChange={(stlMode) =>
              updateItem({
                stlMode: stlMode as StlGraphicMode,
                gerberLayer: gerberLayerForGraphicMode(stlMode as StlGraphicMode, item.gerberLayer),
              })
            }
          />
          {(item.stlMode ?? "raised") === "raised" && (
            <NumberField label="3D height" value={item.reliefHeight ?? 0.4} step={0.05} min={0} onChange={(reliefHeight) => updateItem({ reliefHeight })} suffix="mm" />
          )}
          <SelectField
            label="Gerber"
            value={item.gerberLayer ?? "frontSilk"}
            options={gerberTargetOptions}
            onChange={(gerberLayer) => updateItem({ gerberLayer: gerberLayer as GerberTargetLayer, stlMode: stlModeForGerberLayer(gerberLayer as GerberTargetLayer, item.stlMode) })}
          />
        </>
      )}
      <button type="button" className="danger-action" onClick={onDelete}>
        <Trash2 size={15} />
        Delete object
      </button>
    </PanelBlock>
  );
}

function LayerInspector({
  layer,
  updateLayer,
  onDelete,
}: {
  layer: GerberLayer;
  updateLayer: (patch: Partial<GerberLayer>) => void;
  onDelete: () => void;
}) {
  return (
    <PanelBlock title="Layer Align">
      <TextField label="Name" value={layer.name} onChange={(name) => updateLayer({ name })} />
      <NumberField label="Offset X" value={layer.offsetX} step={0.1} onChange={(offsetX) => updateLayer({ offsetX })} suffix="mm" />
      <NumberField label="Offset Y" value={layer.offsetY} step={0.1} onChange={(offsetY) => updateLayer({ offsetY })} suffix="mm" />
      <NumberField label="Rotate" value={layer.rotation} step={1} onChange={(rotation) => updateLayer({ rotation })} suffix="deg" />
      <NumberField label="Opacity" value={layer.opacity} step={0.05} min={0.05} max={1} onChange={(opacity) => updateLayer({ opacity })} />
      <label className="toggle-row">
        <input type="checkbox" checked={layer.visible} onChange={(event) => updateLayer({ visible: event.target.checked })} />
        Visible
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={layer.mirrorX} onChange={(event) => updateLayer({ mirrorX: event.target.checked })} />
        Mirror X
      </label>
      <label className="color-row">
        Color
        <input type="color" value={layer.color} onChange={(event) => updateLayer({ color: event.target.value })} />
      </label>
      <button type="button" className="danger-action" onClick={onDelete}>
        <Trash2 size={15} />
        Delete layer
      </button>
    </PanelBlock>
  );
}

function PanelBlock({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel-block">
      <div className="panel-title">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <div className="field-input">
        <input
          aria-label={label}
          type="number"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          min={min}
          max={max}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <div className="field-input">
        <input aria-label={label} type="text" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <div className="field-input">
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function FontPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="field-row font-picker-row">
      <span>Font</span>
      <div className="font-picker" role="radiogroup" aria-label="Font">
        {fontOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            className={value === option.value ? "active" : ""}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            style={{ fontFamily: option.value }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  icon: Icon,
  active = false,
  text,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  icon: typeof MousePointer2;
  active?: boolean;
  text?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`icon-button ${active ? "active" : ""} ${text ? "with-text" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} />
      {text && <span>{text}</span>}
    </button>
  );
}

const LayerView = memo(function LayerView({ layer }: { layer: GerberLayer }) {
  const paths = useMemo(() => buildLayerPaths(layer.primitives), [layer.primitives]);
  const transform = `translate(${layer.offsetX} ${layer.offsetY}) rotate(${layer.rotation}) scale(${layer.mirrorX ? -1 : 1} 1)`;
  return (
    <g className="gerber-layer" transform={transform} opacity={layer.opacity} color={layer.color}>
      {paths.lineBatches.map((batch) => (
        <path
          key={`line-${batch.stroke}`}
          className="gerber-layer-batch"
          d={batch.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={batch.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {paths.outlinePath && <path className="gerber-layer-batch" d={paths.outlinePath} fill="none" stroke="currentColor" strokeWidth="0.18" />}
    </g>
  );
});

function buildLayerPaths(primitives: GerberPrimitive[]): LayerPaths {
  const lineMap = new Map<string, { stroke: number; parts: string[] }>();
  const outlineParts: string[] = [];

  for (const primitive of primitives) {
    if (primitive.type === "line") {
      const stroke = Math.max(primitive.stroke, 0.1);
      const key = pathNumber(stroke);
      const batch = lineMap.get(key) ?? { stroke, parts: [] };
      batch.parts.push(`M ${pathNumber(primitive.x1)} ${pathNumber(primitive.y1)} L ${pathNumber(primitive.x2)} ${pathNumber(primitive.y2)}`);
      lineMap.set(key, batch);
      continue;
    }

    if (primitive.type === "rect") {
      outlineParts.push(rectPath(primitive));
      continue;
    }

    outlineParts.push(circlePath(primitive));
  }

  return {
    lineBatches: [...lineMap.values()].map((batch) => ({ stroke: batch.stroke, d: batch.parts.join(" ") })),
    outlinePath: outlineParts.join(" "),
  };
}

function rectPath(primitive: Extract<GerberPrimitive, { type: "rect" }>) {
  const width = Math.max(Math.abs(primitive.width), 0.001);
  const height = Math.max(Math.abs(primitive.height), 0.001);
  const left = primitive.x - width / 2;
  const top = primitive.y - height / 2;
  const right = left + width;
  const bottom = top + height;
  return `M ${pathNumber(left)} ${pathNumber(top)} L ${pathNumber(right)} ${pathNumber(top)} L ${pathNumber(right)} ${pathNumber(bottom)} L ${pathNumber(left)} ${pathNumber(bottom)} Z`;
}

function circlePath(primitive: Extract<GerberPrimitive, { type: "circle" }>) {
  const radius = Math.max(primitive.r, 0.001);
  const left = primitive.x - radius;
  const right = primitive.x + radius;
  return `M ${pathNumber(left)} ${pathNumber(primitive.y)} A ${pathNumber(radius)} ${pathNumber(radius)} 0 1 0 ${pathNumber(right)} ${pathNumber(
    primitive.y,
  )} A ${pathNumber(radius)} ${pathNumber(radius)} 0 1 0 ${pathNumber(left)} ${pathNumber(primitive.y)} Z`;
}

function ItemView({
  item,
  selected,
  layerColors,
  onPointerDown,
  onPointPointerDown,
  onResizePointerDown,
}: {
  item: PanelItem;
  selected: boolean;
  layerColors: Record<GerberTargetLayer, string>;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onPointPointerDown: (event: React.PointerEvent<SVGElement>, item: PanelItem, pointIndex: number) => void;
  onResizePointerDown: (event: React.PointerEvent<SVGElement>, item: PanelItem) => void;
}) {
  const transform = `rotate(${item.rotation ?? 0} ${item.x} ${item.y})`;
  const color = itemDisplayColor(item, layerColors);
  if (item.kind === "artwork") {
    const width = item.width ?? 20;
    const height = item.height ?? 20;
    const tracePaths = hasArtworkTrace(item) ? item.artworkTrace.paths : [];
    return (
      <g className={`item-view artwork ${selected ? "selected" : ""}`} onPointerDown={onPointerDown}>
        <g transform={transform}>
          {tracePaths.length ? (
            tracePaths.map((path, index) => (
              <path key={index} d={localTracePathD(item, path)} fill={color} fillOpacity={item.opacity ?? 1} stroke="none" />
            ))
          ) : item.imageUrl ? (
            <image href={item.imageUrl} x={item.x - width / 2} y={item.y - height / 2} width={width} height={height} opacity={item.opacity ?? 1} />
          ) : (
            <rect x={item.x - width / 2} y={item.y - height / 2} width={width} height={height} fill={color} fillOpacity="0.16" stroke={color} strokeWidth="0.18" />
          )}
          <rect x={item.x - width / 2} y={item.y - height / 2} width={width} height={height} fill="none" stroke={selected ? "#e58614" : color} strokeWidth="0.22" strokeDasharray="1 0.8" />
          <CutoutCue item={item} color={color} />
          {selected && (
            <rect
              className="resize-handle"
              x={item.x + width / 2 - 0.9}
              y={item.y + height / 2 - 0.9}
              width="1.8"
              height="1.8"
              rx="0.2"
              fill="#e58614"
              onPointerDown={(event) => onResizePointerDown(event, item)}
            />
          )}
        </g>
        {tracePaths.length > 0 && (
          <image className="trace-reference-image" href={item.imageUrl} x={item.x - width / 2} y={item.y - height / 2} width={width} height={height} opacity="0" transform={transform} />
        )}
      </g>
    );
  }

  if (item.kind === "text") {
    return (
      <g className={`item-view text ${selected ? "selected" : ""}`} onPointerDown={onPointerDown} transform={transform}>
        <text
          x={item.x}
          y={item.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily={item.fontFamily ?? fontOptions[0].value}
          fontSize={item.fontSize ?? 4}
          fontWeight={item.fontWeight ?? 720}
          fontStyle={item.fontStyle ?? "normal"}
          fill={color}
        >
          {item.text}
        </text>
        <CutoutCue item={item} color={color} />
        {selected && <circle cx={item.x} cy={item.y} r="1.2" fill="#e58614" />}
      </g>
    );
  }

  if (item.kind === "vector-circle") {
    const radius = (item.diameter ?? 8) / 2;
    return (
      <g className={`item-view vector ${selected ? "selected" : ""}`} onPointerDown={onPointerDown} transform={transform}>
        <circle cx={item.x} cy={item.y} r={radius} fill={item.filled ? color : "none"} fillOpacity={item.filled ? 0.14 : undefined} stroke={color} strokeWidth={item.strokeWidth ?? 0.24} />
        <CutoutCue item={item} color={color} />
        {selected && <circle cx={item.x} cy={item.y} r={radius + 1.1} fill="none" stroke="#e58614" strokeWidth="0.18" strokeDasharray="1 0.8" />}
        {selected && <circle className="resize-handle" cx={item.x + radius} cy={item.y} r="0.95" fill="#e58614" onPointerDown={(event) => onResizePointerDown(event, item)} />}
      </g>
    );
  }

  if (item.kind === "vector-rect") {
    const width = item.width ?? 12;
    const height = item.height ?? 8;
    return (
      <g className={`item-view vector ${selected ? "selected" : ""}`} onPointerDown={onPointerDown} transform={transform}>
        <rect
          x={item.x - width / 2}
          y={item.y - height / 2}
          width={width}
          height={height}
          fill={item.filled ? color : "none"}
          fillOpacity={item.filled ? 0.14 : undefined}
          stroke={color}
          strokeWidth={item.strokeWidth ?? 0.24}
        />
        <CutoutCue item={item} color={color} />
        {selected && (
          <>
            <rect
              x={item.x - width / 2 - 0.8}
              y={item.y - height / 2 - 0.8}
              width={width + 1.6}
              height={height + 1.6}
              fill="none"
              stroke="#e58614"
              strokeWidth="0.18"
              strokeDasharray="1 0.8"
            />
            <rect
              className="resize-handle"
              x={item.x + width / 2 - 0.9}
              y={item.y + height / 2 - 0.9}
              width="1.8"
              height="1.8"
              rx="0.2"
              fill="#e58614"
              onPointerDown={(event) => onResizePointerDown(event, item)}
            />
          </>
        )}
      </g>
    );
  }

  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = item.points ?? [];
    const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    return (
      <g className={`item-view vector ${selected ? "selected" : ""}`} onPointerDown={onPointerDown} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation ?? 0})`}>
        <path
          d={`${d}${item.closed ? " Z" : ""}`}
          fill={item.closed && item.filled ? color : "none"}
          fillOpacity={item.closed && item.filled ? 0.16 : undefined}
          stroke={color}
          strokeWidth={item.strokeWidth ?? 0.24}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <CutoutCue item={item} color={color} local />
        {selected &&
          points.map((point, index) => (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              className="point-handle"
              cx={point.x}
              cy={point.y}
              r={index === 0 ? 1.1 : 0.75}
              fill={index === 0 ? "#e58614" : "#f59e0b"}
              onPointerDown={(event) => onPointPointerDown(event, item, index)}
            />
          ))}
      </g>
    );
  }

  const radius = (item.diameter ?? 3.2) / 2;
  return (
    <g className={`item-view cutout ${selected ? "selected" : ""}`} onPointerDown={onPointerDown}>
      <circle cx={item.x} cy={item.y} r={radius} fill="#f8fafc" stroke={color} strokeWidth="0.34" />
      <circle cx={item.x} cy={item.y} r={radius + 1.2} fill="none" stroke={selected ? "#e58614" : "#94a3b8"} strokeWidth="0.16" strokeDasharray="1 0.8" />
      <line x1={item.x - radius - 2} y1={item.y} x2={item.x + radius + 2} y2={item.y} stroke={color} strokeWidth="0.12" />
      <line x1={item.x} y1={item.y - radius - 2} x2={item.x} y2={item.y + radius + 2} stroke={color} strokeWidth="0.12" />
    </g>
  );
}

function CutoutCue({ item, color, local = false }: { item: PanelItem; color: string; local?: boolean }) {
  if (item.stlMode !== "cutout") return null;
  const cueColor = readableCueColor(color);
  const strokeWidth = Math.max(item.strokeWidth ?? 0.24, 0.18);

  if (item.kind === "vector-circle") {
    const radius = (item.diameter ?? 8) / 2;
    const cx = local ? 0 : item.x;
    const cy = local ? 0 : item.y;
    return (
      <g className="cutout-cue" pointerEvents="none">
        <line x1={cx - radius * 0.72} y1={cy - radius * 0.72} x2={cx + radius * 0.72} y2={cy + radius * 0.72} stroke={cueColor} strokeWidth={strokeWidth} />
        <line x1={cx - radius * 0.72} y1={cy + radius * 0.72} x2={cx + radius * 0.72} y2={cy - radius * 0.72} stroke={cueColor} strokeWidth={strokeWidth} />
      </g>
    );
  }

  const bounds = itemCueBounds(item, local);
  if (!bounds) return null;
  const gap = Math.max(Math.min(bounds.width, bounds.height) / 3, 1.3);
  return (
    <g className="cutout-cue" pointerEvents="none">
      <rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill="none" stroke={cueColor} strokeWidth={strokeWidth} strokeDasharray="1 0.8" />
      <line x1={bounds.x + gap} y1={bounds.y} x2={bounds.x} y2={bounds.y + gap} stroke={cueColor} strokeWidth={strokeWidth} />
      <line x1={bounds.x + bounds.width} y1={bounds.y + bounds.height - gap} x2={bounds.x + bounds.width - gap} y2={bounds.y + bounds.height} stroke={cueColor} strokeWidth={strokeWidth} />
      <line x1={bounds.x} y1={bounds.y} x2={bounds.x + bounds.width} y2={bounds.y + bounds.height} stroke={cueColor} strokeWidth={strokeWidth} opacity="0.82" />
      <line x1={bounds.x} y1={bounds.y + bounds.height} x2={bounds.x + bounds.width} y2={bounds.y} stroke={cueColor} strokeWidth={strokeWidth} opacity="0.82" />
    </g>
  );
}

function Rulers({ settings, view, canvasSize }: { settings: PanelSettings; view: ViewState; canvasSize: Size }) {
  const visibleW = canvasSize.width / view.zoom;
  const visibleH = canvasSize.height / view.zoom;
  const startX = Math.floor(view.x / 10) * 10;
  const endX = view.x + visibleW;
  const startY = Math.floor(view.y / 10) * 10;
  const endY = view.y + visibleH;
  const xTicks: number[] = [];
  const yTicks: number[] = [];
  for (let x = startX; x <= endX; x += 10) xTicks.push(x);
  for (let y = startY; y <= endY; y += 10) yTicks.push(y);
  return (
    <g className="rulers" pointerEvents="none">
      {xTicks.map((x) => (
        <g key={`x-${x}`}>
          <line x1={x} y1={0} x2={x} y2={settings.heightMm} stroke="#94a3b8" strokeWidth="0.08" opacity="0.45" />
          {x >= 0 && x <= settings.widthMm && (
            <text x={x + 0.8} y={-3} fontSize="2.4" fill="#475569">
              {x}
            </text>
          )}
        </g>
      ))}
      {yTicks.map((y) => (
        <g key={`y-${y}`}>
          <line x1={0} y1={y} x2={settings.widthMm} y2={y} stroke="#94a3b8" strokeWidth="0.08" opacity="0.45" />
          {y >= 0 && y <= settings.heightMm && (
            <text x={-10} y={y + 0.9} fontSize="2.4" fill="#475569">
              {y}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function iconForItem(kind: PanelItemKind) {
  const size = 16;
  if (kind === "pot") return <Circle size={size} />;
  if (kind === "jack") return <Crosshair size={size} />;
  if (kind === "text") return <Type size={size} />;
  if (kind === "artwork") return <FileImage size={size} />;
  if (kind === "vector-circle") return <Circle size={size} />;
  if (kind === "vector-rect") return <Square size={size} />;
  if (kind === "vector-line") return <Minus size={size} />;
  if (kind === "vector-path") return <PenLine size={size} />;
  return <Square size={size} />;
}

function labelForKind(kind: PanelItemKind) {
  if (kind === "pot") return "Pot";
  if (kind === "jack") return "Jack";
  if (kind === "hole") return "Hole";
  if (kind === "text") return "Text";
  if (kind === "vector-circle") return "Circle";
  if (kind === "vector-rect") return "Rectangle";
  if (kind === "vector-line") return "Line";
  if (kind === "vector-path") return "Path";
  return "Artwork";
}

function stlModeForGerberLayer(gerberLayer: GerberTargetLayer, current?: StlGraphicMode): StlGraphicMode {
  if (gerberLayer === "none") return "cutout";
  if (gerberLayer === "frontReveal" || gerberLayer === "backReveal") return "reveal";
  return current === "cutout" || current === "reveal" ? "raised" : (current ?? "raised");
}

function gerberLayerForGraphicMode(mode: StlGraphicMode, current?: GerberTargetLayer): GerberTargetLayer {
  if (mode === "cutout") return "none";
  if (mode === "reveal") return current === "backMask" || current === "backCopper" || current === "backSilk" || current === "backReveal" ? "backReveal" : "frontReveal";
  return !current || current === "none" || current === "frontMask" || current === "backMask" || current === "frontReveal" || current === "backReveal" ? "frontSilk" : current;
}

function graphicDefaults(gerberLayer: GerberTargetLayer = "frontSilk"): Pick<PanelItem, "gerberLayer" | "reliefHeight" | "stlMode"> {
  return { gerberLayer, reliefHeight: 0.4, stlMode: gerberLayer === "frontReveal" || gerberLayer === "backReveal" ? "reveal" : "raised" };
}

function isGraphicItem(item: PanelItem) {
  return item.kind === "text" || item.kind === "artwork" || item.kind.startsWith("vector-");
}

function objectListLayer(item: PanelItem): GerberTargetLayer {
  if (item.stlMode === "cutout") return "none";
  if (item.stlMode === "reveal") return item.gerberLayer === "backReveal" ? "backReveal" : "frontReveal";
  return isGraphicItem(item) ? (item.gerberLayer ?? "frontSilk") : "none";
}

function itemDisplayColor(item: PanelItem, layerColors: Record<GerberTargetLayer, string>) {
  if (item.stlMode === "cutout" || !isGraphicItem(item)) return layerColors.none;
  if (item.stlMode === "reveal") return layerColors[item.gerberLayer === "backReveal" ? "backReveal" : "frontReveal"];
  return layerColors[item.gerberLayer ?? "frontSilk"];
}

function itemCueBounds(item: PanelItem, local = false) {
  if (item.kind === "text") {
    const width = Math.max((item.text ?? item.label).length * (item.fontSize ?? 4) * 0.62, item.fontSize ?? 4);
    const height = item.fontSize ?? 4;
    return { x: item.x - width / 2, y: item.y - height / 2, width, height };
  }
  if (item.kind === "artwork" || item.kind === "vector-rect") {
    const width = item.width ?? 20;
    const height = item.height ?? item.width ?? 20;
    return { x: item.x - width / 2, y: item.y - height / 2, width, height };
  }
  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = item.points ?? [];
    if (!points.length) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const strokePad = Math.max(item.strokeWidth ?? 0.24, 0.8);
    const minX = Math.min(...xs) - strokePad;
    const minY = Math.min(...ys) - strokePad;
    const maxX = Math.max(...xs) + strokePad;
    const maxY = Math.max(...ys) + strokePad;
    return {
      x: local ? minX : item.x + minX,
      y: local ? minY : item.y + minY,
      width: Math.max(maxX - minX, strokePad * 2),
      height: Math.max(maxY - minY, strokePad * 2),
    };
  }
  return null;
}

function readableCueColor(color: string) {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "#111827";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 148 ? "#111827" : "#f8fafc";
}

function localTracePathD(item: PanelItem, path: Point2D[]) {
  const width = item.width ?? 20;
  const height = item.height ?? width;
  return `${path.map((point, index) => `${index === 0 ? "M" : "L"} ${item.x + point.x * width} ${item.y + point.y * height}`).join(" ")} Z`;
}

function holePresetValue(diameter: number) {
  const match = holePresetOptions.find((option) => option.value !== "custom" && Math.abs(Number(option.value) - diameter) < 0.01);
  return match?.value ?? "custom";
}

function pcbArea(settings: PanelSettings) {
  const x = clamp(settings.pcbInsetX ?? 5, 0, settings.widthMm / 2);
  const y = clamp(settings.pcbInsetY ?? 8, 0, settings.heightMm / 2);
  return {
    x,
    y,
    width: Math.max(settings.widthMm - x * 2, 0),
    height: Math.max(settings.heightMm - y * 2, 0),
  };
}

function createPanelThreeShape(settings: PanelSettings, cutouts: ThreeCutoutShape[]) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(settings.widthMm, 0);
  shape.lineTo(settings.widthMm, settings.heightMm);
  shape.lineTo(0, settings.heightMm);
  shape.lineTo(0, 0);
  shape.holes.push(...cutouts.map((cutout) => cutout.shape));
  return shape;
}

function threeCutoutShapes(settings: PanelSettings, items: PanelItem[]): ThreeCutoutShape[] {
  const physical: ThreeCutoutShape[] = panelHoles(settings, items).map((hole) => ({
    shape: circleThreeShape(hole.x, hole.y, hole.diameter / 2, true),
    kind: "physical",
  }));

  const graphics = items.flatMap((item): ThreeCutoutShape[] => {
    if (item.stlMode !== "cutout") return [];
    if (item.kind === "vector-circle") return [{ shape: circleThreeShape(item.x, item.y, (item.diameter ?? 8) / 2, true), kind: "graphic" }];
    if (item.kind === "artwork" && hasArtworkTrace(item)) return artworkTracePathsForItem(item).map((path) => ({ shape: shapeFromPoints(path, true), kind: "graphic" }));
    if (item.kind === "text" || item.kind === "artwork" || item.kind === "vector-rect") return [{ shape: shapeFromPoints(rectPointsForItem(item), true), kind: "graphic" }];
    if (item.kind === "vector-line" || item.kind === "vector-path") {
      const points = absoluteVectorPointsForApp(item);
      if (item.kind === "vector-path" && item.closed && item.filled && points.length > 2) return [{ shape: shapeFromPoints(points, true), kind: "graphic" }];
      return strokeLoopsForApp(points, item.closed ?? false, Math.max(item.strokeWidth ?? 0.24, 0.2)).map((pointsForSlot) => ({
        shape: shapeFromPoints(pointsForSlot, true),
        kind: "graphic",
      }));
    }
    return [];
  });

  return [...physical, ...graphics];
}

function addThreeGraphic(group: THREE.Group, item: PanelItem, layerColors: Record<GerberTargetLayer, string>, zTop: number, cutouts: ThreeCutoutShape[]) {
  const color = itemDisplayColor(item, layerColors);
  if (item.stlMode === "reveal") {
    addThreeRevealGraphic(group, item, color, zTop);
    return;
  }
  const relief = Math.max(item.reliefHeight ?? 0.4, 0.04);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: item.gerberLayer?.includes("Copper") ? 0.35 : 0.05 });

  if (item.kind === "text") {
    addThreeText(group, item, color, zTop + relief + 0.08);
    return;
  }

  if (item.kind === "artwork") {
    if (hasArtworkTrace(item)) {
      for (const path of artworkTracePathsForItem(item)) {
        addThreeRaisedShape(group, shapeFromPoints(path, false), material, zTop, relief, cutouts);
      }
      return;
    }
    addThreeRaisedShape(group, shapeFromPoints(rectPointsForItem(item), false), material, zTop, relief, cutouts);
    return;
  }

  if (item.kind === "vector-circle") {
    const shape = circleThreeShape(item.x, item.y, (item.diameter ?? 8) / 2, false);
    if (item.filled) addThreeRaisedShape(group, shape, material, zTop, relief, cutouts);
    else addThreeLine(group, circlePoints(item.x, item.y, (item.diameter ?? 8) / 2, 64), color, zTop + relief + 0.08, true);
    return;
  }

  if (item.kind === "vector-rect") {
    const points = rectPointsForItem(item);
    if (item.filled) addThreeRaisedShape(group, shapeFromPoints(points, false), material, zTop, relief, cutouts);
    else addThreeLine(group, points, color, zTop + relief + 0.08, true);
    return;
  }

  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = absoluteVectorPointsForApp(item);
    if (item.kind === "vector-path" && item.closed && item.filled && points.length > 2) {
      addThreeRaisedShape(group, shapeFromPoints(points, false), material, zTop, relief, cutouts);
    } else {
      addThreeLine(group, points, color, zTop + relief + 0.08, item.closed ?? false);
    }
  }
}

function addThreeRevealGraphic(group: THREE.Group, item: PanelItem, color: string, zTop: number) {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const z = zTop + 0.07;

  if (item.kind === "text") {
    addThreeText(group, item, color, z + 0.02);
    return;
  }

  if (item.kind === "artwork") {
    if (hasArtworkTrace(item)) {
      for (const path of artworkTracePathsForItem(item)) addThreeFlatShape(group, shapeFromPoints(path, false), material, z);
      return;
    }
    addThreeFlatShape(group, shapeFromPoints(rectPointsForItem(item), false), material, z);
    return;
  }

  if (item.kind === "vector-circle") {
    const radius = (item.diameter ?? 8) / 2;
    if (item.filled) addThreeFlatShape(group, circleThreeShape(item.x, item.y, radius, false), material, z);
    else addThreeLine(group, circlePoints(item.x, item.y, radius, 64), color, z + 0.02, true);
    return;
  }

  if (item.kind === "vector-rect") {
    const points = rectPointsForItem(item);
    if (item.filled) addThreeFlatShape(group, shapeFromPoints(points, false), material, z);
    else addThreeLine(group, points, color, z + 0.02, true);
    return;
  }

  if (item.kind === "vector-line" || item.kind === "vector-path") {
    const points = absoluteVectorPointsForApp(item);
    if (item.kind === "vector-path" && item.closed && item.filled && points.length > 2) addThreeFlatShape(group, shapeFromPoints(points, false), material, z);
    else addThreeLine(group, points, color, z + 0.02, item.closed ?? false);
  }
}

function addThreeFlatShape(group: THREE.Group, shape: THREE.Shape, material: THREE.Material, z: number) {
  const geometry = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  group.add(mesh);
  addThreeShapeOutline(group, shape, "#0f172a", z + 0.01, 0.16);
}
function addThreeRaisedShape(group: THREE.Group, shape: THREE.Shape, material: THREE.Material, zTop: number, relief: number, cutouts: ThreeCutoutShape[]) {
  const raisedShape = shapeWithNestedCutouts(shape, cutouts);
  const geometry = new THREE.ExtrudeGeometry(raisedShape, {
    depth: relief,
    bevelEnabled: false,
    curveSegments: 32,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = zTop + 0.04;
  mesh.castShadow = true;
  group.add(mesh);
}

function addThreeCutoutDepth(group: THREE.Group, cutout: ThreeCutoutShape, panelThickness: number, maxRelief: number) {
  const shadowGeometry = new THREE.ShapeGeometry(cutout.shape);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: "#0f172a", transparent: true, opacity: cutout.kind === "physical" ? 0.16 : 0.22, side: THREE.DoubleSide, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.position.z = -0.08;
  group.add(shadow);

  addThreeShapeOutline(group, cutout.shape, "#0f172a", panelThickness + maxRelief + 0.14, 0.74);
  addThreeShapeOutline(group, cutout.shape, "#f8fafc", -0.06, 0.32);
}

function addThreeShapeOutline(group: THREE.Group, shape: THREE.Shape, color: string, z: number, opacity: number) {
  const points = shape.getPoints(72);
  if (points.length < 2) return;
  const linePoints = [...points, points[0]].map((point) => new THREE.Vector3(point.x, point.y, z));
  const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
}

function addThreeText(group: THREE.Group, item: PanelItem, color: string, z: number) {
  const text = item.text ?? "";
  if (!text) return;
  const fontSize = item.fontSize ?? 4;
  const width = Math.max(text.length * fontSize * 0.65, fontSize);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = `${item.fontStyle === "italic" ? "italic " : ""}${item.fontWeight ?? 720} 72px ${item.fontFamily ?? "Inter, Arial, sans-serif"}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, fontSize * 1.35), material);
  mesh.position.set(item.x, item.y, z);
  mesh.rotation.z = ((item.rotation ?? 0) * Math.PI) / 180;
  mesh.scale.y = -1;
  group.add(mesh);
}

function addThreeLine(group: THREE.Group, points: Point2D[], color: string, z: number, closed: boolean) {
  if (points.length < 2) return;
  const linePoints = [...points, ...(closed ? [points[0]] : [])].map((point) => new THREE.Vector3(point.x, point.y, z));
  const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
  group.add(line);
}

function addThreeCutoutCue(group: THREE.Group, shape: THREE.Shape, z: number) {
  const points: THREE.Vector2[] = shape.getPoints(24);
  if (!points.length) return;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const cuePoints = [
    new THREE.Vector3(minX, minY, z),
    new THREE.Vector3(maxX, maxY, z),
    new THREE.Vector3(minX, maxY, z),
    new THREE.Vector3(maxX, minY, z),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(cuePoints);
  group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#f8fafc", linewidth: 2, transparent: true, opacity: 0.85 })));
}

function circleThreeShape(x: number, y: number, radius: number, clockwise: boolean) {
  const shape = new THREE.Shape();
  shape.absarc(x, y, Math.max(radius, 0.01), 0, Math.PI * 2, clockwise);
  return shape;
}

function shapeFromPoints(points: Point2D[], clockwise: boolean) {
  const area = polygonAreaForApp(points);
  const ordered = (clockwise && area > 0) || (!clockwise && area < 0) ? [...points].reverse() : points;
  const shape = new THREE.Shape();
  if (!ordered.length) return shape;
  shape.moveTo(ordered[0].x, ordered[0].y);
  ordered.slice(1).forEach((point) => shape.lineTo(point.x, point.y));
  shape.lineTo(ordered[0].x, ordered[0].y);
  return shape;
}

function shapeWithNestedCutouts(shape: THREE.Shape, cutouts: ThreeCutoutShape[]) {
  const raisedShape = shape.clone();
  const shapePoints = shape.getPoints(36).map((point) => ({ x: point.x, y: point.y }));
  const shapeBounds = boundsForPoints(shapePoints);
  if (!shapeBounds || shapePoints.length < 3) return raisedShape;

  for (const cutout of cutouts) {
    const cutoutPoints = cutout.shape.getPoints(36).map((point) => ({ x: point.x, y: point.y }));
    const cutoutBounds = boundsForPoints(cutoutPoints);
    if (!cutoutBounds || !boundsOverlap(shapeBounds, cutoutBounds)) continue;
    if (pointInsidePolygonForApp(centerForBounds(cutoutBounds), shapePoints)) {
      raisedShape.holes.push(cutout.shape.clone());
    }
  }

  return raisedShape;
}

function boundsForPoints(points: Point2D[]) {
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function centerForBounds(bounds: NonNullable<ReturnType<typeof boundsForPoints>>): Point2D {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

function boundsOverlap(a: NonNullable<ReturnType<typeof boundsForPoints>>, b: NonNullable<ReturnType<typeof boundsForPoints>>) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function pointInsidePolygonForApp(point: Point2D, polygon: Point2D[]) {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const crosses = current.y > point.y !== previous.y > point.y;
    const intersectX = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || 0.000001) + current.x;
    if (crosses && point.x < intersectX) inside = !inside;
  }
  return inside;
}

function rectPointsForItem(item: PanelItem): Point2D[] {
  const width = item.kind === "text" ? Math.max((item.text ?? item.label).length * (item.fontSize ?? 4) * 0.62, item.fontSize ?? 4) : item.width ?? 20;
  const height = item.kind === "text" ? item.fontSize ?? 4 : item.height ?? item.width ?? 20;
  return [
    rotatePointForApp(item, -width / 2, -height / 2),
    rotatePointForApp(item, width / 2, -height / 2),
    rotatePointForApp(item, width / 2, height / 2),
    rotatePointForApp(item, -width / 2, height / 2),
  ];
}

function absoluteVectorPointsForApp(item: PanelItem): Point2D[] {
  return (item.points ?? []).map((point) => rotatePointForApp(item, point.x, point.y));
}

function rotatePointForApp(item: PanelItem, localX: number, localY: number): Point2D {
  const radians = ((item.rotation ?? 0) * Math.PI) / 180;
  return {
    x: item.x + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: item.y + localX * Math.sin(radians) + localY * Math.cos(radians),
  };
}

function circlePoints(x: number, y: number, radius: number, segments: number): Point2D[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
}

function strokeLoopsForApp(points: Point2D[], closed: boolean, width: number) {
  const loops: Point2D[][] = [];
  for (let index = 1; index < points.length; index += 1) loops.push(strokeLoopForApp(points[index - 1], points[index], width));
  if (closed && points.length > 2) loops.push(strokeLoopForApp(points.at(-1) ?? points[0], points[0], width));
  return loops;
}

function strokeLoopForApp(start: Point2D, end: Point2D, width: number): Point2D[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (width / 2);
  const ny = (dx / length) * (width / 2);
  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

function polygonAreaForApp(points: Point2D[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function wrapAngle(angle: number) {
  if (angle > 180) return angle - 360;
  if (angle < -180) return angle + 360;
  return angle;
}

function traceModeFromResult(mode?: "alpha" | "luma" | "inverted-luma"): TraceMode {
  if (mode === "alpha") return "alpha";
  if (mode === "inverted-luma") return "light";
  if (mode === "luma") return "dark";
  return "auto";
}

function traceModeLabel(mode: TraceMode) {
  return traceModeOptions.find((option) => option.value === mode)?.label ?? "Auto";
}

function clonePanelItem(item: PanelItem): PanelItem {
  return {
    ...item,
    points: item.points?.map((point) => ({ ...point })),
    artworkTrace: item.artworkTrace
      ? {
          ...item.artworkTrace,
          paths: item.artworkTrace.paths.map((path) => path.map((point) => ({ ...point }))),
        }
      : undefined,
  };
}

function copyLabel(label: string) {
  return /\bcopy\b/i.test(label) ? label : `${label} copy`;
}

function disposeThreeMaterial(material: THREE.Material) {
  const maybeTextured = material as THREE.Material & { map?: THREE.Texture };
  maybeTextured.map?.dispose();
  material.dispose();
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type GerberImportPayload = {
  name: string;
  text: string;
};

async function expandGerberFiles(files: File[]): Promise<GerberImportPayload[]> {
  const payloads: GerberImportPayload[] = [];

  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entries = Object.values(zip.files)
        .filter((entry) => !entry.dir && isGerberImportName(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        payloads.push({
          name: entry.name.split(/[\\/]/).pop() ?? entry.name,
          text: await entry.async("string"),
        });
      }
      continue;
    }

    if (isGerberImportName(file.name)) {
      payloads.push({ name: file.name, text: await file.text() });
    }
  }

  return payloads;
}

function isGerberImportName(name: string) {
  return /\.(gbr|ger|gtl|gbl|gto|gbo|gm1|gko|drl|xln|txt|dxf)$/i.test(name);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pathNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(3)).toString();
}

function round(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

export default App;
