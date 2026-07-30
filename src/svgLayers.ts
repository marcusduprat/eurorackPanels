export type SvgArtworkLayer = {
  name: string;
  imageUrl: string;
  aspectRatio: number;
  embeddedRasterCount: number;
};

export function svgArtworkLayers(source: string, fileName: string): SvgArtworkLayer[] {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) {
    return [{ name: baseName, imageUrl: svgDataUrl(source), aspectRatio: 1, embeddedRasterCount: 0 }];
  }

  const rootChildren = Array.from(root.children);
  const directGroups = rootChildren.filter((element) => element.localName === "g");
  const namedGroups = directGroups.filter((element) => Boolean(svgLayerName(element)));
  const layerGroups = namedGroups.length > 1 ? namedGroups : [];
  const aspectRatio = svgAspectRatio(root);

  if (!layerGroups.length) {
    return [{ name: baseName, imageUrl: svgDataUrl(source), aspectRatio, embeddedRasterCount: root.querySelectorAll("image").length }];
  }

  const layerIndexes = new Set(layerGroups.map((layer) => rootChildren.indexOf(layer)));
  return layerGroups.map((layer) => {
    const targetIndex = rootChildren.indexOf(layer);
    const isolatedRoot = root.cloneNode(true) as SVGSVGElement;
    const isolatedLayer = isolatedRoot.children.item(targetIndex);
    Array.from(isolatedRoot.children).forEach((child, index) => {
      if (layerIndexes.has(index) && index !== targetIndex) child.remove();
    });

    if (isolatedLayer instanceof SVGElement) {
      isolatedLayer.removeAttribute("display");
      isolatedLayer.removeAttribute("visibility");
      isolatedLayer.style.removeProperty("display");
      isolatedLayer.style.removeProperty("visibility");
    }

    const serialized = new XMLSerializer().serializeToString(isolatedRoot);
    return {
      name: `${baseName} / ${svgLayerName(layer) ?? `Layer ${targetIndex + 1}`}`,
      imageUrl: svgDataUrl(serialized),
      aspectRatio,
      embeddedRasterCount: isolatedRoot.querySelectorAll("image").length,
    };
  });
}

function svgLayerName(element: Element) {
  const value =
    element.getAttributeNS("http://www.inkscape.org/namespaces/inkscape", "label") ??
    element.getAttribute("inkscape:label") ??
    element.getAttribute("aria-label") ??
    element.getAttribute("data-name") ??
    element.getAttribute("id");
  return value?.trim() || null;
}

function svgAspectRatio(root: Element) {
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return viewBox[2] / viewBox[3];
  }

  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 1;
}

function svgDataUrl(source: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}
