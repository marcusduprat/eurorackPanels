export type PanelItemKind = "pot" | "jack" | "hole" | "text" | "artwork" | "vector-circle" | "vector-rect" | "vector-line" | "vector-path";

export type GerberTargetLayer = "none" | "frontMask" | "frontSilk" | "frontCopper" | "frontReveal" | "backMask" | "backSilk" | "backCopper" | "backReveal";

export type StlGraphicMode = "raised" | "cutout" | "reveal";

export type VectorPoint = {
  x: number;
  y: number;
};

export type TraceMode = "auto" | "dark" | "light" | "alpha";

export type ArtworkTrace = {
  version?: number;
  sourceWidth: number;
  sourceHeight: number;
  gridWidth: number;
  gridHeight: number;
  threshold: number;
  detail?: number;
  requestedMode?: TraceMode;
  mode: "alpha" | "luma" | "inverted-luma";
  paths: VectorPoint[][];
};

export type PanelItem = {
  id: string;
  kind: PanelItemKind;
  label: string;
  x: number;
  y: number;
  diameter?: number;
  width?: number;
  height?: number;
  rotation?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  imageUrl?: string;
  fileName?: string;
  artworkTrace?: ArtworkTrace;
  editorVisible?: boolean;
  locked?: boolean;
  opacity?: number;
  reliefHeight?: number;
  stlMode?: StlGraphicMode;
  gerberLayer?: GerberTargetLayer;
  strokeWidth?: number;
  points?: VectorPoint[];
  closed?: boolean;
  filled?: boolean;
};

export type GerberPrimitive =
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: number;
    }
  | {
      type: "circle";
      x: number;
      y: number;
      r: number;
    }
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
    };

export type GerberLayer = {
  id: string;
  name: string;
  fileName: string;
  kind: "gerber" | "drill" | "drawing";
  color: string;
  opacity: number;
  visible: boolean;
  offsetX: number;
  offsetY: number;
  rotation: number;
  mirrorX: boolean;
  primitives: GerberPrimitive[];
  bounds: Bounds | null;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type PanelSettings = {
  hp: number;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  mountHoleDiameter: number;
  mountHoleInsetX: number;
  mountHoleInsetY: number;
  showMountingHoles: boolean;
  showPcbArea?: boolean;
  pcbInsetX?: number;
  pcbInsetY?: number;
  pcbColor?: string;
  gridMm: number;
};

export type ToolMode = "select" | PanelItemKind;

export type DragState =
  | {
      type: "item";
      id: string;
      startX: number;
      startY: number;
      itemX: number;
      itemY: number;
    }
  | {
      type: "layer-group";
      startX: number;
      startY: number;
      offsets: Array<{ id: string; offsetX: number; offsetY: number }>;
    }
  | {
      type: "shape";
      id: string;
      kind: "vector-circle" | "vector-rect" | "vector-line";
      startX: number;
      startY: number;
    }
  | {
      type: "vector-point";
      id: string;
      pointIndex: number;
    }
  | {
      type: "resize";
      id: string;
      kind: "artwork" | "vector-circle" | "vector-rect";
    }
  | {
      type: "pan";
      startX: number;
      startY: number;
      viewX: number;
      viewY: number;
    };
