import React, { useEffect, useMemo, useRef, useState } from "react";
// App.jsx — Overlay Studio (solo este archivo en el lienzo)
// Superposición de imágenes por capas estilo Photoshop.
// - Mantiene formato y resolución de la imagen base al exportar
// - Varias capas: input múltiple, drag&drop, pegar desde portapapeles
// - Mover, redimensionar (conservar proporción), rotar, opacidad, modos de fusión
// - Reordenar, duplicar, eliminar y descargas (base/capa/crop/transformada)

// Utilidades
const uid = () => Math.random().toString(36).slice(2, 9);

const CANVAS_BLEND_TO_CSS = {
  "source-over": "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color-dodge",
  "color-burn": "color-burn",
  "hard-light": "hard-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

const CSS_BLEND_TO_CANVAS = Object.fromEntries(
  Object.entries(CANVAS_BLEND_TO_CSS).map(([k, v]) => [v, k])
);

// Carga de imágenes
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Error leyendo el archivo"));
    reader.onload = () => {
      const url = reader.result;
      const img = new Image();
      img.onload = () => {
        resolve({
          img,
          url,
          mime: file.type || inferMimeFromName(file.name) || "image/png",
          name: file.name || "imagen",
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
      };
      img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

function inferMimeFromName(name) {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return null;
}

export default function OverlayStudio() {
  const stageWrapRef = useRef(null);
  const stageRef = useRef(null);

  const [base, setBase] = useState(null);
  const [layers, setLayers] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [keepRatio, setKeepRatio] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  // Pestañas móviles: 'left' | 'canvas' | 'right'
  const [mobileTab, setMobileTab] = useState("canvas");

  const [fitScale, setFitScale] = useState(1);
  const viewScale = fitScale * zoom;

  const activeIndex = useMemo(() => layers.findIndex(l => l.id === activeId), [layers, activeId]);
  const activeLayer = activeIndex >= 0 ? layers[activeIndex] : null;

  // Ajustar escala para encajar en el viewport
  useEffect(() => {
    function calcFit() {
      if (!stageWrapRef.current || !base) return setFitScale(1);
      const rect = stageWrapRef.current.getBoundingClientRect();
      const maxW = Math.max(200, rect.width - 16);
      const maxH = Math.max(200, rect.height - 16);
      const scale = Math.min(maxW / base.naturalWidth, maxH / base.naturalHeight);
      setFitScale(isFinite(scale) && scale > 0 ? Math.min(scale, 1) : 1);
    }
    calcFit();
    window.addEventListener("resize", calcFit);
    return () => window.removeEventListener("resize", calcFit);
  }, [base]);

  // Teclas de flecha para mover (Shift = 10px)
  useEffect(() => {
    function onKey(e) {
      if (!activeLayer) return;
      const step = e.shiftKey ? 10 : 1;
      const upd = (dx, dy) => {
        setLayers(prev => prev.map(l => (l.id === activeLayer.id ? { ...l, x: l.x + dx, y: l.y + dy } : l)));
      };
      if (e.key === "ArrowLeft") { e.preventDefault(); upd(-step, 0); }
      if (e.key === "ArrowRight") { e.preventDefault(); upd(step, 0); }
      if (e.key === "ArrowUp") { e.preventDefault(); upd(0, -step); }
      if (e.key === "ArrowDown") { e.preventDefault(); upd(0, step); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeLayer(activeLayer.id); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeLayer]);

  // Pegar imágenes desde el portapapeles (Ctrl/Cmd+V)
  useEffect(() => {
    function onPaste(e) {
      const files = e.clipboardData?.files;
      if (files && files.length) {
        handleFilesToLayers(files);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [base]);

  // Cambiar pestaña por defecto en móvil según haya base o no
  useEffect(() => {
    setMobileTab(base ? "canvas" : "left");
  }, [base]);

  // Inputs de archivo
  const baseInputRef = useRef(null);
  const overlayInputRef = useRef(null);

  async function handlePickBase(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const data = await loadImageFile(file);
    setBase(data);
    setLayers([]);
    setActiveId(null);
    setZoom(1);
    setTimeout(() => {
      if (stageWrapRef.current) {
        const rect = stageWrapRef.current.getBoundingClientRect();
        const maxW = Math.max(200, rect.width - 16);
        const maxH = Math.max(200, rect.height - 16);
        const scale = Math.min(maxW / data.naturalWidth, maxH / data.naturalHeight);
        setFitScale(isFinite(scale) && scale > 0 ? Math.min(scale, 1) : 1);
      }
    }, 0);
  }

  // Añadir capas (drag&drop, input o portapapeles)
  async function handleFilesToLayers(filesLike) {
    const files = Array.from(filesLike || []).filter(f => f && f.type && f.type.startsWith("image/"));
    if (!files.length) return;
    const loaded = await Promise.all(files.map(loadImageFile));

    // Si no hay base aún, la primera imagen se usa como base automáticamente
    let imagesToAdd = loaded;
    let baseDims = base ? { w: base.naturalWidth, h: base.naturalHeight } : null;
    if (!base && loaded.length) {
      const [first, ...rest] = loaded;
      setBase(first);
      baseDims = { w: first.naturalWidth, h: first.naturalHeight };
      imagesToAdd = rest;
    }

    let lastId = null;
    setLayers(prev => {
      const arr = [...prev];
      imagesToAdd.forEach((data, i) => {
        const id = uid();
        lastId = id;
        const maxW = (baseDims ? baseDims.w : data.naturalWidth);
        const maxH = (baseDims ? baseDims.h : data.naturalHeight);
        arr.push({
          id,
          name: data.name || `Capa ${prev.length + i + 1}`,
          data,
          x: 20 + i * 10,
          y: 20 + i * 10,
          width: Math.min(data.naturalWidth, maxW),
          height: Math.min(data.naturalHeight, maxH),
          rotation: 0,
          opacity: 1,
          blendMode: "source-over",
          visible: true,
        });
      });
      return arr;
    });
    if (lastId) setActiveId(lastId);
  }

  // Drag & drop compartido
  function onDragOverFiles(e) { e.preventDefault(); setIsDragging(true); }
  function onDragEnterFiles(e) { e.preventDefault(); setIsDragging(true); }
  function onDragLeaveFiles(e) { e.preventDefault(); setIsDragging(false); }
  async function onDropFiles(e) { e.preventDefault(); setIsDragging(false); const files = e.dataTransfer?.files; await handleFilesToLayers(files); }

  async function handleAddOverlays(ev) {
    const files = ev.target.files || [];
    await handleFilesToLayers(files);
    ev.target.value = ""; // limpia input para poder re-seleccionar los mismos archivos
  }

  function bringForward(id) {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const arr = [...prev];
      const [item] = arr.splice(idx, 1);
      arr.splice(idx + 1, 0, item);
      return arr;
    });
  }

  function sendBackward(id) {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx <= 0) return prev;
      const arr = [...prev];
      const [item] = arr.splice(idx, 1);
      arr.splice(idx - 1, 0, item);
      return arr;
    });
  }

  function removeLayer(id) {
    setLayers(prev => prev.filter(l => l.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function cloneLayer(id) {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === id);
      if (idx < 0) return prev;
      const src = prev[idx];
      const clone = {
        ...src,
        id: uid(),
        name: src.name + " copia",
        x: src.x + 20,
        y: src.y + 20,
      };
      const arr = [...prev];
      arr.splice(idx + 1, 0, clone);
      return arr;
    });
  }

  const stageSize = useMemo(() => {
    if (!base) return { w: 640, h: 360 };
    return { w: Math.round(base.naturalWidth * viewScale), h: Math.round(base.naturalHeight * viewScale) };
  }, [base, viewScale]);

  function updateActive(partial) {
    if (!activeLayer) return;
    setLayers(prev => prev.map(l => (l.id === activeLayer.id ? { ...l, ...partial } : l)));
  }

  // Descargas
  function sanitizeFileBase(name) {
    return (name || "imagen").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  }
  function downloadDataURL(filename, dataURL) {
    const a = document.createElement("a");
    a.href = dataURL;
    a.download = filename;
    a.click();
  }
  function handleDownloadBaseOriginal() {
    if (!base) return;
    const ext = base.mime === "image/png" ? "png" : base.mime === "image/jpeg" ? "jpg" : base.mime === "image/webp" ? "webp" : "png";
    const fname = sanitizeFileBase(base.name) + `_original.${ext}`;
    downloadDataURL(fname, base.url);
  }
  function handleDownloadLayerOriginal(l) {
    const mime = l.data.mime || inferMimeFromName(l.data.name) || "image/png";
    const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
    const fname = sanitizeFileBase(l.data.name || l.name) + `_original.${ext}`;
    downloadDataURL(fname, l.data.url);
  }
  function handleDownloadLayerCrop(l) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(l.width));
    canvas.height = Math.max(1, Math.round(l.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(l.data.img, 0, 0, canvas.width, canvas.height);
    const dataURL = canvas.toDataURL("image/png");
    const fname = `${sanitizeFileBase(l.data.name || l.name)}_crop_${canvas.width}x${canvas.height}.png`;
    downloadDataURL(fname, dataURL);
  }
  function handleDownloadLayerTransformed(l) {
    const rad = (l.rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const w = l.width, h = l.height;
    const bw = Math.abs(w * cos) + Math.abs(h * sin);
    const bh = Math.abs(w * sin) + Math.abs(h * cos);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bw));
    canvas.height = Math.max(1, Math.round(bh));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(l.data.img, -w / 2, -h / 2, w, h);
    const dataURL = canvas.toDataURL("image/png");
    const fname = `${sanitizeFileBase(l.data.name || l.name)}_rot_${Math.round(l.rotation)}deg_${canvas.width}x${canvas.height}.png`;
    downloadDataURL(fname, dataURL);
  }

  // Exportar manteniendo formato/resolución de la base
  async function handleExport() {
    if (!base) return;
    const canvas = document.createElement("canvas");
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // base
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(base.img, 0, 0, base.naturalWidth, base.naturalHeight);
    ctx.restore();

    // overlays en orden
    for (const l of layers) {
      if (!l.visible) continue;
      ctx.save();
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = l.blendMode || "source-over";
      const cx = l.x + l.width / 2;
      const cy = l.y + l.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((l.rotation * Math.PI) / 180);
      ctx.drawImage(l.data.img, -l.width / 2, -l.height / 2, l.width, l.height);
      ctx.restore();
    }

    const mime = base.mime && ["image/png", "image/jpeg", "image/webp"].includes(base.mime)
      ? base.mime
      : "image/png";
    const quality = mime === "image/jpeg" ? 0.92 : 1.0;
    const dataURL = canvas.toDataURL(mime, quality);
    const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
    const fname = (base.name ? base.name.replace(/\.[^.]+$/, "") : "composicion") + "_composite." + ext;
    downloadDataURL(fname, dataURL);
  }

  function cssBlendFor(l) {
    return CANVAS_BLEND_TO_CSS[l.blendMode] || "normal";
  }

  // Interacción (arrastrar/redimensionar/rotar)
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [rotating, setRotating] = useState(null);
  // Soporte táctil/unificado con Pointer Events
  // (seguimos soportando mouse events por compatibilidad)


  function onMouseDownLayer(e, l) {
    if (!base) return;
    setActiveId(l.id);
    const target = e.target;
    if (target?.dataset?.handle) return; // si es un handle, otro flujo maneja
    const sx = e.clientX; const sy = e.clientY;
    setDragging({ id: l.id, startX: sx, startY: sy, startLX: l.x, startLY: l.y });
  }

  // === Pointer Events (táctil + mouse) ===
  function onPointerDownLayer(e, l) {
    if (!base) return;
    setActiveId(l.id);
    if (e.pointerType === 'touch') e.preventDefault();
    const target = e.target;
    if (target?.dataset?.handle) return;
    try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
    setDragging({ id: l.id, startX: e.clientX, startY: e.clientY, startLX: l.x, startLY: l.y });
  };

  function onMouseMove(e) {
    if (!base) return;
    const scale = viewScale;
    if (dragging) {
      const dx = (e.clientX - dragging.startX) / scale;
      const dy = (e.clientY - dragging.startY) / scale;
      setLayers(prev => prev.map(l => l.id === dragging.id ? { ...l, x: dragging.startLX + dx, y: dragging.startLY + dy } : l));
    }
    if (resizing) {
      const { id, handle, startX, startY, start } = resizing;
      let dx = (e.clientX - startX) / scale;
      let dy = (e.clientY - startY) / scale;
      let x = start.x, y = start.y, w = start.w, h = start.h;
      const ratio = h ? start.w / start.h : 1;
      if (handle === "se") { w = start.w + dx; h = keepRatio ? w / ratio : start.h + dy; }
      if (handle === "sw") { w = start.w - dx; h = keepRatio ? w / ratio : start.h + dy; x = start.x + dx; }
      if (handle === "ne") { w = start.w + dx; h = keepRatio ? w / ratio : start.h - dy; y = start.y + (start.h - h); }
      if (handle === "nw") { w = start.w - dx; h = keepRatio ? w / ratio : start.h - dy; x = start.x + dx; y = start.y + (start.h - h); }
      w = Math.max(5, w);
      h = Math.max(5, h);
      setLayers(prev => prev.map(l => l.id === id ? { ...l, x, y, width: w, height: h } : l));
    }
    if (rotating) {
      const { id, startAngle, cx, cy } = rotating;
      const ang = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
      const deg = ang - startAngle;
      setLayers(prev => prev.map(l => l.id === id ? { ...l, rotation: deg } : l));
    }
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch') e.preventDefault();
    onMouseMove(e);
  }

  function onMouseUp() { setDragging(null); setResizing(null); setRotating(null); }
  function onPointerUp() { setDragging(null); setResizing(null); setRotating(null); }

  // UI
  return (
    <div className="w-full h-full min-h-[560px] grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-3 lg:gap-4 p-3 lg:p-4 bg-neutral-100 text-neutral-900">
      {/* Controles móviles */}
      <div className="lg:hidden -mt-1 mb-2">
        <div className="flex gap-2">
          <button onClick={() => setMobileTab('left')} className={`flex-1 rounded-xl px-3 py-2 border ${mobileTab==='left'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}>Proyecto</button>
          <button onClick={() => setMobileTab('canvas')} className={`flex-1 rounded-xl px-3 py-2 border ${mobileTab==='canvas'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}>Lienzo</button>
          <button onClick={() => setMobileTab('right')} className={`flex-1 rounded-xl px-3 py-2 border ${mobileTab==='right'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}>Propiedades</button>
        </div>
      </div>
      {/* Panel izquierdo */}
      <aside className={`bg-white rounded-2xl shadow-sm p-4 gap-4 ${mobileTab==='left' ? 'flex' : 'hidden'} lg:flex flex-col`}>
        <h2 className="text-lg font-semibold">Proyecto</h2>
        <div className="space-y-3">
          <button
            className="w-full rounded-xl border px-3 py-2 hover:bg-neutral-50"
            onClick={() => baseInputRef.current?.click()}
          >
            1) Cargar imagen base
          </button>
          <input ref={baseInputRef} type="file" accept="image/*" className="hidden" onChange={handlePickBase} />

          <button
            className="w-full rounded-xl border px-3 py-2 hover:bg-neutral-50 disabled:opacity-50"
            disabled={!base}
            onClick={() => overlayInputRef.current?.click()}
          >
            2) Añadir capa(s) (imagen) — soporta múltiples
          </button>
          <input ref={overlayInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAddOverlays} />

          <div
            className={`mt-2 rounded-xl border-2 border-dashed p-3 text-xs text-center cursor-copy ${isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-neutral-300 text-neutral-500'}`}
            onDragOver={onDragOverFiles}
            onDragEnter={onDragEnterFiles}
            onDragLeave={onDragLeaveFiles}
            onDrop={onDropFiles}
          >
            Arrastra imágenes aquí o pega con <kbd>Ctrl</kbd>+<kbd>V</kbd> para añadir <strong>múltiples capas</strong>.
          </div>

          <div className="pt-2 border-t">
            <label className="text-sm font-medium block mb-2">Zoom ({Math.round(zoom * 100)}%)</label>
            <input
              type="range" min={0.25} max={2} step={0.05}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex items-center gap-2 mt-2">
              <input id="grid" type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              <label htmlFor="grid" className="text-sm">Mostrar cuadrícula</label>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input id="ratio" type="checkbox" checked={keepRatio} onChange={(e) => setKeepRatio(e.target.checked)} />
              <label htmlFor="ratio" className="text-sm">Mantener proporción al redimensionar</label>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="font-semibold mb-2">Capas</h3>
          <div className="max-h-[50vh] overflow-auto space-y-2 pr-1">
            {layers.map((l, idx) => (
              <div key={l.id} className={`rounded-xl border p-2 text-sm ${l.id === activeId ? "ring-2 ring-indigo-500" : ""}`}>
                <div className="flex items-center justify-between">
                  <button className="truncate text-left font-medium" onClick={() => setActiveId(l.id)} title={l.name}>
                    {l.name}
                  </button>
                  <div className="flex items-center gap-1">
                    <button className="px-2 py-1 rounded hover:bg-neutral-100" title="Subir" onClick={() => bringForward(l.id)} disabled={idx === layers.length - 1}>▲</button>
                    <button className="px-2 py-1 rounded hover:bg-neutral-100" title="Bajar" onClick={() => sendBackward(l.id)} disabled={idx === 0}>▼</button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input type="checkbox" checked={l.visible} onChange={(e) => setLayers(prev => prev.map(x => x.id === l.id ? { ...x, visible: e.target.checked } : x))} />
                  <span className="text-xs">Visible</span>
                  <button className="ml-auto text-xs px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200" onClick={() => cloneLayer(l.id)}>Duplicar</button>
                  <button className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100" onClick={() => removeLayer(l.id)}>Eliminar</button>
                </div>
              </div>
            ))}
            {!layers.length && <p className="text-xs text-neutral-500">(Agrega una o más capas de imagen)</p>}
          </div>
        </div>

        <div className="mt-auto pt-3 border-t">
          <button
            className="w-full rounded-xl bg-indigo-600 text-white px-4 py-2 disabled:opacity-50"
            disabled={!base}
            onClick={handleExport}
          >
            Exportar (mantener formato y resolución de la base)
          </button>
          {base && (
            <div className="flex gap-2 mt-2">
              <button className="flex-1 rounded-xl border px-3 py-2 hover:bg-neutral-50" onClick={handleDownloadBaseOriginal}>Descargar base (original)</button>
            </div>
          )}
          {base && (
            <p className="text-xs text-neutral-500 mt-2">Salida: {base.naturalWidth}×{base.naturalHeight} • {base.mime || "image/png"}</p>
          )}
        </div>
      </aside>

      {/* Lienzo */}
      <section className={`relative rounded-2xl bg-white shadow-sm overflow-hidden ${mobileTab==='canvas' ? 'block' : 'hidden'} lg:block min-h-[60vh]`} onDragOver={onDragOverFiles} onDragEnter={onDragEnterFiles} onDragLeave={onDragLeaveFiles} onDrop={onDropFiles}>
        <div ref={stageWrapRef} className="absolute inset-0 p-2">
          <div
            ref={stageRef}
            className="relative mx-auto my-auto w-full h-full flex items-center justify-center select-none touch-none"
            onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
            onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          >
            {base ? (
              <div
                className="relative"
                style={{ width: stageSize.w + "px", height: stageSize.h + "px" }}
                onMouseUp={onMouseUp}
              >
                {/* fondo damero para transparencia */}
                <div className="absolute inset-0 bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(135deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(135deg,transparent_75%,#eee_75%)] bg-[length:20px_20px] bg-[position:0_0,10px_0,10px_-10px,0px_10px] rounded-xl"></div>
                {/* cuadrícula opcional */}
                {showGrid && (
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,.05)_1px,transparent_1px)]" style={{ backgroundSize: `${20 * viewScale}px ${20 * viewScale}px` }}></div>
                )}
                {/* Imagen base */}
                <img src={base.url} alt="base" draggable={false} className="absolute inset-0 w-full h-full object-contain rounded-xl" />

                {/* Capas */}
                {layers.map((l) => {
                  if (!l.visible) return null;
                  const sel = l.id === activeId;
                  const style = {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: l.width * viewScale,
                    height: l.height * viewScale,
                    transform: `translate(${l.x * viewScale}px, ${l.y * viewScale}px) rotate(${l.rotation}deg)`,
                    transformOrigin: "top left",
                    opacity: l.opacity,
                    mixBlendMode: cssBlendFor(l),
                    boxShadow: sel ? "0 0 0 1px rgba(99,102,241,.9)" : undefined,
                    borderRadius: 6,
                    cursor: sel ? "move" : "default",
                  };
                  return (
                    <div key={l.id} style={style} className="touch-none" onMouseDown={(e) => onMouseDownLayer(e, l)} onPointerDown={(e) => onPointerDownLayer(e, l)}>
                      <img src={l.data.url} alt={l.name} draggable={false} className="w-full h-full object-contain rounded-md" />
                      {sel && (
                        <>
                          {/* asas de redimensionado */}
                          {["nw", "ne", "sw", "se"].map(h => (
                            <div key={h}
                              data-handle
                              onMouseDown={(e) => { e.stopPropagation(); setResizing({ id: l.id, handle: h, startX: e.clientX, startY: e.clientY, start: { x: l.x, y: l.y, w: l.width, h: l.height } }); }}
                              onPointerDown={(e) => { e.stopPropagation(); if (e.pointerType==='touch') e.preventDefault(); setResizing({ id: l.id, handle: h, startX: e.clientX, startY: e.clientY, start: { x: l.x, y: l.y, w: l.width, h: l.height } }); }}
                              className={`absolute w-3 h-3 touch-none bg-white border-2 border-indigo-500 rounded -translate-x-1/2 -translate-y-1/2 ${
                                h === "nw" ? "left-0 top-0" : h === "ne" ? "left-full top-0" : h === "sw" ? "left-0 top-full" : "left-full top-full"
                              }`}
                              title={`Redimensionar ${h.toUpperCase()}`}
                            />
                          ))}
                          {/* perilla de rotación */}
                          <div
                            data-handle
                            onMouseDown={(e) => { e.stopPropagation(); const parentRect = stageRef.current?.getBoundingClientRect(); const cx = (l.x + l.width / 2) * viewScale + (parentRect?.left || 0); const cy = (l.y + l.height / 2) * viewScale + (parentRect?.top || 0); const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI; setRotating({ id: l.id, startX: e.clientX, startY: e.clientY, startAngle, cx, cy }); }}
                            onPointerDown={(e) => { e.stopPropagation(); if (e.pointerType==='touch') e.preventDefault(); const parentRect = stageRef.current?.getBoundingClientRect(); const cx = (l.x + l.width / 2) * viewScale + (parentRect?.left || 0); const cy = (l.y + l.height / 2) * viewScale + (parentRect?.top || 0); const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI; setRotating({ id: l.id, startX: e.clientX, startY: e.clientY, startAngle, cx, cy }); }}
                            className="absolute left-1/2 -translate-x-1/2 -top-6 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white shadow touch-none"
                            title="Rotar"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-neutral-500">
                <p className="font-medium">Carga una imagen base para comenzar</p>
                <p className="text-sm">Se mantendrán el formato y la resolución de esta imagen al exportar.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Panel derecho */}
      <aside className={`bg-white rounded-2xl shadow-sm p-4 gap-4 ${mobileTab==='right' ? 'flex' : 'hidden'} lg:flex flex-col`}>
        <h2 className="text-lg font-semibold">Propiedades</h2>
        {activeLayer ? (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-neutral-500">Nombre</label>
              <input
                className="w-full border rounded-xl px-3 py-2 mt-1"
                value={activeLayer.name}
                onChange={(e) => updateActive({ name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-500">X</label>
                <input type="number" className="w-full border rounded-xl px-2 py-1 mt-1" value={Math.round(activeLayer.x)} onChange={(e) => updateActive({ x: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Y</label>
                <input type="number" className="w-full border rounded-xl px-2 py-1 mt-1" value={Math.round(activeLayer.y)} onChange={(e) => updateActive({ y: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Ancho</label>
                <input type="number" className="w-full border rounded-xl px-2 py-1 mt-1" value={Math.round(activeLayer.width)} onChange={(e) => updateActive({ width: Math.max(1, parseFloat(e.target.value) || 1) })} />
              </div>
              <div>
                <label className="text-xs text-neutral-500">Alto</label>
                <input type="number" className="w-full border rounded-xl px-2 py-1 mt-1" value={Math.round(activeLayer.height)} onChange={(e) => updateActive({ height: Math.max(1, parseFloat(e.target.value) || 1) })} />
              </div>
            </div>

            <div>
              <label className="text-xs text-neutral-500">Rotación: {Math.round(activeLayer.rotation)}°</label>
              <input type="range" min={-180} max={180} step={1} value={activeLayer.rotation} onChange={(e) => updateActive({ rotation: parseFloat(e.target.value) })} className="w-full" />
            </div>

            <div>
              <label className="text-xs text-neutral-500">Opacidad: {Math.round(activeLayer.opacity * 100)}%</label>
              <input type="range" min={0} max={1} step={0.01} value={activeLayer.opacity} onChange={(e) => updateActive({ opacity: parseFloat(e.target.value) })} className="w-full" />
            </div>

            <div>
              <label className="text-xs text-neutral-500">Modo de fusión</label>
              <select
                className="w-full border rounded-xl px-3 py-2 mt-1"
                value={CANVAS_BLEND_TO_CSS[activeLayer.blendMode] || "normal"}
                onChange={(e) => {
                  const val = e.target.value;
                  const canvasOp = CSS_BLEND_TO_CANVAS[val] || "source-over";
                  updateActive({ blendMode: canvasOp });
                }}
              >
                {Object.values(CANVAS_BLEND_TO_CSS).map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" checked={activeLayer.visible} onChange={(e) => updateActive({ visible: e.target.checked })} />
              <span className="text-sm">Visible</span>
            </div>

            <div className="pt-2 border-t">
              <h4 className="text-sm font-medium mb-2">Descargas</h4>
              <div className="flex flex-wrap gap-2 mb-3">
                <button className="rounded-xl border px-3 py-2 hover:bg-neutral-50" onClick={() => handleDownloadLayerOriginal(activeLayer)}>Original</button>
                <button className="rounded-xl border px-3 py-2 hover:bg-neutral-50" onClick={() => handleDownloadLayerCrop(activeLayer)}>Recorte</button>
                <button className="rounded-xl border px-3 py-2 hover:bg-neutral-50" onClick={() => handleDownloadLayerTransformed(activeLayer)}>Transformada</button>
              </div>
            </div>
            <div className="pt-2 border-t flex gap-2">
              <button className="flex-1 rounded-xl border px-3 py-2 hover:bg-neutral-50" onClick={() => sendBackward(activeLayer.id)}>Bajar</button>
              <button className="flex-1 rounded-xl border px-3 py-2 hover:bg-neutral-50" onClick={() => bringForward(activeLayer.id)}>Subir</button>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 rounded-xl bg-neutral-100 px-3 py-2 hover:bg-neutral-200" onClick={() => cloneLayer(activeLayer.id)}>Duplicar</button>
              <button className="flex-1 rounded-xl bg-red-50 text-red-700 px-3 py-2 hover:bg-red-100" onClick={() => removeLayer(activeLayer.id)}>Eliminar</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">Selecciona una capa para editar sus propiedades.</p>
        )}

        <div className="mt-auto text-xs text-neutral-500">
          <p>Consejo: con una capa seleccionada, usa las flechas para mover 1px (Shift = 10px). Supr/Borrar elimina la capa activa.</p>
          <p className="mt-1">Compatibilidad de modos de fusión depende del navegador. La exportación usa Canvas 2D.</p>
        </div>
      </aside>
    </div>
  );
}