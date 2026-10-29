import { useEffect, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowUpRight, Box, Check, ChevronRight,
  CircleHelp, CloudUpload, Cpu, Download, FileImage, Fingerprint, Image as ImageIcon,
  LoaderCircle, Pause, Play, ScanSearch, ShieldCheck, Sparkles, Upload, Ruler,
  RotateCcw, RotateCw, X, Layers3, BrainCircuit
} from "lucide-react";
import "./App.css";

const API = (import.meta.env.PROD
  ? (import.meta.env.VITE_API_BASE_URL || "")
  : "http://127.0.0.1:8001").replace(/\/+$/, "");
const MAX_SIZE = 15 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

function StatusDot({ ok }) {
  return <span className={`status-dot ${ok ? "is-online" : "is-offline"}`} />;
}

function projectCloudPoint(point, bounds, width, height, rotation) {
  const center = bounds.min.map((value, index) => (value + bounds.max[index]) / 2);
  const span = Math.max(...bounds.max.map((value, index) => value - bounds.min[index]), 0.000001);
  const scale = Math.min(width, height) * 0.72 * (rotation.zoom || 1) / span;
  const [x, y, z] = point.map((value, index) => (value - center[index]) * scale);
  const cosYaw = Math.cos(rotation.yaw);
  const sinYaw = Math.sin(rotation.yaw);
  const rotatedX = x * cosYaw + z * sinYaw;
  const rotatedZ = -x * sinYaw + z * cosYaw;
  const cosPitch = Math.cos(rotation.pitch);
  const sinPitch = Math.sin(rotation.pitch);
  const rotatedY = y * cosPitch - rotatedZ * sinPitch;
  const depth = y * sinPitch + rotatedZ * cosPitch;
  const perspective = 2.8 / (2.8 + depth / Math.max(scale, 1));
  return {
    x: width / 2 + rotatedX * perspective,
    y: height / 2 - rotatedY * perspective,
    depth,
    perspective,
  };
}

function buildSampleMugModel() {
  const points = [];
  const triangles = [];
  const rings = [];
  const segments = 48;
  const bands = 24;
  for (let band = 0; band <= bands; band += 1) {
    const y = -0.75 + band / bands * 1.4;
    const radius = 0.52 + band / bands * 0.09;
    const ring = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2;
      const light = Math.max(0, Math.cos(angle - 0.65));
      ring.push(points.length);
      points.push([radius * Math.cos(angle), y, radius * Math.sin(angle), 157 + light * 60, 61 + light * 51, 44 + light * 39]);
    }
    rings.push(ring);
  }
  for (let band = 0; band < bands; band += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = rings[band][segment]; const b = rings[band][next];
      const c = rings[band + 1][next]; const d = rings[band + 1][segment];
      for (const face of [[a, b, c], [a, c, d]]) triangles.push([...face.flatMap(index => points[index].slice(0, 3)), 196, 92, 64]);
    }
  }
  const handleRings = [];
  const handleBands = 34;
  const handleSegments = 12;
  for (let band = 0; band <= handleBands; band += 1) {
    const t = -Math.PI / 2 + band / handleBands * Math.PI;
    const cx = 0.55 + 0.41 * Math.cos(t);
    const cy = 0.5 * Math.sin(t);
    const tangentLength = Math.hypot(0.41 * Math.sin(t), 0.5 * Math.cos(t));
    const nx = -(0.5 * Math.cos(t)) / tangentLength;
    const ny = (0.41 * Math.sin(t)) / tangentLength;
    const ring = [];
    for (let segment = 0; segment < handleSegments; segment += 1) {
      const angle = segment / handleSegments * Math.PI * 2;
      ring.push(points.length);
      points.push([cx + nx * 0.07 * Math.cos(angle), cy + ny * 0.07 * Math.cos(angle), 0.07 * Math.sin(angle), 124, 55, 44]);
    }
    handleRings.push(ring);
  }
  for (let band = 0; band < handleBands; band += 1) {
    for (let segment = 0; segment < handleSegments; segment += 1) {
      const next = (segment + 1) % handleSegments;
      const a = handleRings[band][segment]; const b = handleRings[band][next];
      const c = handleRings[band + 1][next]; const d = handleRings[band + 1][segment];
      for (const face of [[a, b, c], [a, c, d]]) triangles.push([...face.flatMap(index => points[index].slice(0, 3)), 130, 57, 45]);
    }
  }
  return {
    points,
    triangles,
    source_point_count: points.length,
    source_face_count: triangles.length,
    bounds: {
      min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]))),
    },
    units: "unscaled",
  };
}

function PointCloudViewer({ model, selected, onSelect }) {
  const canvasRef = useRef(null);
  const [rotation, setRotation] = useState({ yaw: 0.55, pitch: 0.34, zoom: 1 });
  const [autoRotate, setAutoRotate] = useState(false);
  const drag = useRef(null);

  useEffect(() => {
    if (!autoRotate) return undefined;
    let frame = 0;
    let previous = 0;
    const animate = timestamp => {
      if (timestamp - previous >= 33) {
        setRotation(current => ({ ...current, yaw: current.yaw + 0.012 }));
        previous = timestamp;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model?.points?.length) return;
    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#080f18";
    context.fillRect(0, 0, rect.width, rect.height);
    const faces = (model.triangles || []).map(triangle => {
      const vertices = [triangle.slice(0, 3), triangle.slice(3, 6), triangle.slice(6, 9)];
      const projectedVertices = vertices.map(point => projectCloudPoint(point, model.bounds, rect.width, rect.height, rotation));
      return {
        projectedVertices,
        vertices,
        depth: projectedVertices.reduce((total, point) => total + point.depth, 0) / 3,
        color: triangle.slice(9, 12),
      };
    }).sort((a, b) => b.depth - a.depth);
    for (const face of faces) {
      const [red, green, blue] = face.color.map(value => Math.max(0, Math.min(255, value)));
      const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = face.vertices;
      const ux = bx - ax; const uy = by - ay; const uz = bz - az;
      const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
      const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const length = Math.hypot(...normal) || 1;
      const light = Math.abs((normal[0] * -0.35 + normal[1] * 0.72 + normal[2] * 0.6) / length);
      const shade = 0.42 + light * 0.58;
      context.globalAlpha = 0.94;
      context.fillStyle = `rgb(${Math.round(red * shade)} ${Math.round(green * shade)} ${Math.round(blue * shade)})`;
      context.beginPath();
      context.moveTo(face.projectedVertices[0].x, face.projectedVertices[0].y);
      context.lineTo(face.projectedVertices[1].x, face.projectedVertices[1].y);
      context.lineTo(face.projectedVertices[2].x, face.projectedVertices[2].y);
      context.closePath();
      context.fill();
    }
    const projected = model.points.map((point, index) => ({
      point,
      index,
      ...projectCloudPoint(point, model.bounds, rect.width, rect.height, rotation),
    })).sort((a, b) => b.depth - a.depth);
    for (const item of projected) {
      const [red, green, blue] = item.point.slice(3).map(value => Math.max(0, Math.min(255, value)));
      context.fillStyle = `rgb(${red} ${green} ${blue})`;
      context.globalAlpha = 0.48 + Math.min(0.5, item.perspective * 0.35);
      const radius = Math.max(1, Math.min(3, 1.15 * item.perspective));
      context.beginPath();
      context.arc(item.x, item.y, radius, 0, Math.PI * 2);
      context.fill();
      if (selected.includes(item.index)) {
        context.globalAlpha = 1;
        context.strokeStyle = "#8ff0d2";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(item.x, item.y, 7, 0, Math.PI * 2);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }, [model, rotation, selected]);

  function handlePointerDown(event) {
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true;
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    setRotation(current => ({
      yaw: current.yaw + dx * 0.008,
      pitch: Math.max(-1.45, Math.min(1.45, current.pitch + dy * 0.008)),
      zoom: current.zoom,
    }));
  }

  function handlePointerUp(event) {
    if (!drag.current) return;
    const wasDrag = drag.current.moved;
    drag.current = null;
    if (wasDrag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    let nearest = -1;
    let nearestDistance = 18;
    model.points.forEach((point, index) => {
      const projected = projectCloudPoint(point, model.bounds, rect.width, rect.height, rotation);
      const distance = Math.hypot(projected.x - (event.clientX - rect.left), projected.y - (event.clientY - rect.top));
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
    });
    if (nearest >= 0) onSelect(model.points[nearest].slice(0, 3), nearest);
  }

  return <div className="viewer-stage"><canvas ref={canvasRef} className="point-cloud-canvas" aria-label="Interactive 3D product view. Drag horizontally for a full 360 degree orbit, drag vertically to tilt, and click two points for scale calibration." onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={event => setRotation(current => ({ ...current, zoom: Math.max(0.55, Math.min(2.5, current.zoom * (event.deltaY < 0 ? 1.08 : 0.92))) }))} /><div className="viewer-controls"><button className={autoRotate ? "viewer-control active" : "viewer-control"} onClick={() => setAutoRotate(value => !value)}>{autoRotate ? <Pause size={13}/> : <Play size={13}/>} {autoRotate ? "Pause rotation" : "Auto-rotate 360°"}</button><button className="viewer-control" onClick={() => { setAutoRotate(false); setRotation({ yaw: 0.55, pitch: 0.34, zoom: 1 }); }}><RotateCw size={13}/> Reset view</button></div></div>;
}

export default function App() {
  const singleInput = useRef(null);
  const multiInput = useRef(null);
  const [view, setView] = useState("analyze");
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [backend, setBackend] = useState("checking");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [models, setModels] = useState([]);
  const [colmap, setColmap] = useState("checking");
  const [analysis, setAnalysis] = useState(null);
  const [analysisState, setAnalysisState] = useState("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [question, setQuestion] = useState("");
  const [photos, setPhotos] = useState([]);
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [jobMessage, setJobMessage] = useState("");
  const [modelData, setModelData] = useState(null);
  const [modelError, setModelError] = useState("");
  const [pickedPoints, setPickedPoints] = useState([]);
  const [knownDistance, setKnownDistance] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [copiedAnalysis, setCopiedAnalysis] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!API) {
      setBackend("offline");
      setColmap("offline");
      return () => { alive = false; };
    }
    Promise.all([fetch(`${API}/api/health`), fetch(`${API}/api/colmap/status`), fetch(`${API}/api/ai/status`)])
      .then(async ([health, reconstruction, aiStatus]) => {
        const h = health.ok ? await health.json() : {};
        const c = reconstruction.ok ? await reconstruction.json() : {};
        const ai = aiStatus.ok ? await aiStatus.json() : {};
        if (alive) {
          setBackend(h.status === "healthy" ? "online" : "offline");
          setColmap(c.status === "installed" ? "ready" : c.status || "offline");
          setAiConfigured(Boolean(ai.configured));
          setModels(ai.models || []);
        }
      }).catch(() => { if (alive) { setBackend("offline"); setColmap("offline"); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!jobId || !["queued", "processing"].includes(jobStatus)) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${API}/api/measurement/${jobId}/status`);
        if (!response.ok) return;
        const data = await response.json();
        setJobStatus(data.status || "processing");
        setJobMessage(data.message || "Processing photos…");
      } catch { setJobMessage("Connection interrupted. The backend may still be processing."); }
    }, 2500);
    return () => clearInterval(timer);
  }, [jobId, jobStatus]);

  useEffect(() => {
    if (!jobId || jobStatus !== "completed") return undefined;
    let alive = true;
    fetch(`${API}/api/measurement/${jobId}/model`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "The model preview could not be loaded.");
        if (alive) setModelData(data);
      })
      .catch(error => { if (alive) setModelError(error.message || "The model preview could not be loaded."); });
    return () => { alive = false; };
  }, [jobId, jobStatus]);

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  function chooseImage(file) {
    if (!file) return;
    setAnalysisError("");
    if (!ACCEPTED.includes(file.type)) { setAnalysisError("Use a JPG, PNG or WEBP image."); return; }
    if (file.size > MAX_SIZE) { setAnalysisError("This image is larger than 15 MB."); return; }
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
    setAnalysisState("idle");
    setAnalysis(null);
    setAnalysisError("");
  }

  async function loadSampleImage() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}sample-mug.png`);
      if (!response.ok) throw new Error("Sample image could not be loaded.");
      const blob = await response.blob();
      chooseImage(new File([blob], "sample-terracotta-mug.png", { type: "image/png" }));
    } catch (error) {
      setAnalysisError(error.message || "Sample image could not be loaded.");
    }
  }

  async function analyzeImage() {
    if (!imageFile) return;
    if (!API) {
      setAnalysisError("Image analysis needs a hosted backend. The GitHub Pages version currently provides the interface and sample 3D model.");
      setAnalysisState("error");
      return;
    }
    setAnalysisError(""); setAnalysis(null); setAnalysisState("loading");
    try {
      const form = new FormData();
      form.append("file", imageFile);
      form.append("question", question);
      const response = await fetch(`${API}/api/analyze`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Image analysis failed.");
      setAnalysis(data); setAnalysisState("done");
    } catch (error) {
      setAnalysisError(error.message || "Could not connect to the image assistant.");
      setAnalysisState("error");
    }
  }

  function choosePhotos(files) {
    const next = [...photos];
    let skippedType = false;
    let skippedSize = false;
    let skippedLimit = false;
    for (const file of files) {
      if (!ACCEPTED.includes(file.type)) { skippedType = true; continue; }
      if (file.size > MAX_SIZE) { skippedSize = true; continue; }
      if (next.length >= 30) { skippedLimit = true; continue; }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setPhotos(next);
    setPhotoError(skippedType ? "Some files were skipped. Use JPG, PNG, or WEBP images." : skippedSize ? "Some files were skipped because they are larger than 15 MB." : skippedLimit ? "You can use up to 30 photos per reconstruction." : "");
    setJobStatus(""); setJobId(""); setJobMessage(""); setModelData(null); setModelError(""); setPickedPoints([]); setKnownDistance(""); setDemoMode(false);
  }

  function clearPhotos() {
    photos.forEach(photo => URL.revokeObjectURL(photo.url));
    setPhotos([]); setPhotoError(""); setJobStatus(""); setJobId(""); setJobMessage(""); setModelData(null); setModelError(""); setPickedPoints([]); setKnownDistance(""); setDemoMode(false);
  }

  function removePhoto(index) {
    const photo = photos[index];
    if (photo) URL.revokeObjectURL(photo.url);
    setPhotos(current => current.filter((_, photoIndex) => photoIndex !== index));
    setJobStatus(""); setJobId(""); setJobMessage(""); setModelData(null); setModelError(""); setPickedPoints([]); setKnownDistance(""); setDemoMode(false);
  }

  function openDemoModel() {
    setModelData(buildSampleMugModel());
    setModelError(""); setPickedPoints([]); setKnownDistance("");
    setJobId(""); setJobStatus(""); setJobMessage(""); setDemoMode(true);
  }

  function selectCalibrationPoint(point, pointIndex) {
    setPickedPoints(current => current.length === 1 ? [...current, { coordinates: point, index: pointIndex }] : [{ coordinates: point, index: pointIndex }]);
  }

  const calibration = (() => {
    const realDistance = Number(knownDistance);
    if (!modelData || pickedPoints.length !== 2 || !Number.isFinite(realDistance) || realDistance <= 0) return null;
    const worldDistance = Math.hypot(...pickedPoints[0].coordinates.map((value, index) => value - pickedPoints[1].coordinates[index]));
    if (!worldDistance) return null;
    const factor = realDistance / worldDistance;
    const extents = modelData.bounds.max.map((value, index) => (value - modelData.bounds.min[index]) * factor).sort((a, b) => b - a);
    return { length: extents[0], width: extents[1], height: extents[2], unit: "cm" };
  })();

  async function copyAnalysis() {
    try {
      await navigator.clipboard.writeText(analysis.response);
      setCopiedAnalysis(true);
      window.setTimeout(() => setCopiedAnalysis(false), 1600);
    } catch {
      setAnalysisError("Clipboard access is unavailable in this browser.");
    }
  }

  function downloadAnalysis() {
    const report = `Helix Nebula image analysis\nModel: ${analysis.model}\n\n${analysis.response}\n\nAI-origin assessments are estimates from visual clues and cannot prove image provenance.`;
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "helix-nebula-image-analysis.txt";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function uploadPhotos() {
    if (photos.length < 5) { setJobStatus("failed"); setJobMessage("Add at least five clear, overlapping product photos to continue."); return; }
    if (!API) { setJobStatus("failed"); setJobMessage("3D reconstruction needs a hosted backend and COLMAP. The GitHub Pages version currently provides the sample 3D model."); return; }
    if (backend !== "online") { setJobStatus("failed"); setJobMessage("Start the FastAPI backend at 127.0.0.1:8001, then try again."); return; }
    setBusy(true); setJobStatus("processing"); setJobMessage("Uploading photos…");
    try {
      const form = new FormData();
      photos.forEach(({ file }) => form.append("files", file));
      const upload = await fetch(`${API}/api/measurement/upload`, { method: "POST", body: form });
      const uploaded = await upload.json();
      if (!upload.ok) throw new Error(uploaded.detail || "Photo upload failed.");
      setJobId(uploaded.job_id);
      const started = await fetch(`${API}/api/measurement/${uploaded.job_id}/reconstruct`, { method: "POST" });
      const result = await started.json();
      if (!started.ok) throw new Error(result.detail || "Could not start reconstruction.");
      setJobStatus(result.status); setJobMessage(result.message);
    } catch (error) { setJobStatus("failed"); setJobMessage(error.message || "Could not connect to the reconstruction service."); }
    finally { setBusy(false); }
  }

  const nav = (target) => { setView(target); setAnalysisError(""); };
  return (
    <div className="hn-app">
      <header className="hn-topbar">
        <div className="hn-brand"><div className="hn-logo"><Layers3 size={21} /></div><div><div className="hn-brand-name">Helix<span> Nebula</span></div><div className="hn-brand-sub">IMAGE INTELLIGENCE STUDIO</div></div></div>
        <div className="hn-top-status"><span className="local-pill"><ShieldCheck size={14} /> {import.meta.env.PROD ? "Hosted backend" : "Local backend"}</span><span className="top-divider"/><span className="service-status"><StatusDot ok={backend === "online"} /> API {backend}</span></div>
      </header>
      <div className="hn-body">
        <aside className="hn-sidebar"><div className="sidebar-label">WORKSPACE</div>
          <button className={`nav-item ${view === "analyze" ? "active" : ""}`} onClick={() => nav("analyze")}><ScanSearch size={17}/> Image analysis <ChevronRight className="nav-chevron" size={14}/></button>
          <button className={`nav-item ${view === "model" ? "active" : ""}`} onClick={() => nav("model")}><Box size={17}/> 3D product model <ChevronRight className="nav-chevron" size={14}/></button>
          <div className="sidebar-label download-section-label">DOWNLOADS</div>
          <a className="nav-item report-download-link" href={`${import.meta.env.BASE_URL}helix-nebula-feature-report.html`} download="Helix-Nebula-Feature-Report.html"><Download size={17}/> Download feature report</a>
          <div className="sidebar-label system-label">SERVICES</div>
          <div className="system-row"><div className="system-icon"><Activity size={16}/></div><div><span>OpenRouter vision</span><small>{aiConfigured ? `${models.length} models · free routing` : (API ? "API key required" : "Backend not connected")}</small></div><StatusDot ok={aiConfigured}/></div>
          <div className="system-row"><div className="system-icon"><Cpu size={16}/></div><div><span>COLMAP engine</span><small>{colmap === "ready" ? "Ready for reconstruction" : colmap.replaceAll("_", " ")}</small></div><StatusDot ok={colmap === "ready"}/></div>
          <div className="sidebar-bottom"><div className="sidebar-avatar"><Sparkles size={17}/></div><div><strong>Helix Nebula Studio</strong><span>Image tools workspace</span></div></div>
        </aside>
        <main className="hn-main">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> {view === "analyze" ? "IMAGE INTELLIGENCE" : "MULTI-VIEW RECONSTRUCTION"}</div><h1>{view === "analyze" ? <>Discover more in <span>every image.</span></> : <>Turn photos into <span>3D.</span></>}</h1><p>{view === "analyze" ? "Inspect an image, check for AI signals and get a clear visual summary." : "Build a product model from overlapping photos and prepare it for dimension calibration."}</p></div><div className="heading-chip"><Fingerprint size={15}/> AI-assisted workspace</div></div>

          {view === "analyze" ? <div className="analysis-layout">
            <section className="panel image-panel"><div className="panel-head"><div><span className="panel-kicker">01 / SOURCE</span><h2>Image input</h2></div><span className="panel-meta">JPG, PNG, WEBP · 15 MB max</span></div>
              <div className={`image-dropzone ${dragging ? "dragging" : ""} ${imageUrl ? "has-image" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); chooseImage(e.dataTransfer.files[0]); }}>
                {imageUrl ? <><img className="source-image" src={imageUrl} alt="Selected image"/><div className="image-overlay"><span><FileImage size={14}/>{imageFile.name}</span><button onClick={() => { setImageFile(null); setImageUrl(""); setAnalysisState("idle"); }} aria-label="Remove image"><X size={14}/></button></div></> : <div className="upload-empty"><div className="upload-icon"><CloudUpload size={25}/></div><h3>Drop an image to begin</h3><p>Upload a single image to prepare it for analysis.</p><button className="primary-btn" onClick={() => singleInput.current?.click()}><Upload size={15}/> Choose image</button><button className="sample-btn" onClick={loadSampleImage}><ImageIcon size={14}/> Try sample photo</button><span className="file-note">One image · up to 15 MB</span></div>}
              </div><input ref={singleInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => chooseImage(e.target.files?.[0])}/>
              <div className="image-actions"><div className="file-details"><div className="file-detail-icon"><ImageIcon size={16}/></div><div><strong>{imageFile?.name || "No image selected"}</strong><small>{imageFile ? `${(imageFile.size / 1024 / 1024).toFixed(2)} MB · ready to inspect` : "Your image preview will appear here"}</small></div></div>{imageFile && <button className="secondary-btn" onClick={() => singleInput.current?.click()}>Replace</button>}</div>
              {analysisError && <div className="inline-error"><AlertCircle size={15}/>{analysisError}</div>}
              <button className="analyze-btn" disabled={!imageFile || analysisState === "loading"} onClick={analyzeImage}><ScanSearch size={16}/>{analysisState === "loading" ? "Asking OpenRouter…" : "Analyze image"}<ArrowUpRight size={15}/></button><p className="privacy-note"><ShieldCheck size={13}/> Image is sent to OpenRouter; the API key stays on your backend.</p>
            </section>
            <section className="panel insights-panel"><div className="panel-head"><div><span className="panel-kicker">02 / INSIGHTS</span><h2>AI image assistant</h2></div><span className={`result-status ${aiConfigured ? "result-ready" : ""}`}><span/> {aiConfigured ? "OpenRouter ready" : (API ? "Needs API key" : "Backend offline")}</span></div>
              {analysis ? <div className="analysis-results"><div className="origin-card"><span className="result-title"><Sparkles size={15}/><h3>Image summary & assessment</h3></span><p>{analysis.response}</p><div className="confidence-row"><span>Model route</span><strong>{analysis.model}</strong></div></div><p className="disclaimer"><AlertCircle size={14}/> AI-origin assessments are estimates from visual clues; they cannot verify provenance.</p><div className="result-actions"><button className="secondary-btn" onClick={copyAnalysis}>{copiedAnalysis ? <Check size={14}/> : <FileImage size={14}/>} {copiedAnalysis ? "Copied" : "Copy result"}</button><button className="secondary-btn" onClick={downloadAnalysis}><Download size={14}/> Download report</button><button className="secondary-btn" onClick={analyzeImage}><RotateCcw size={14}/> Run again</button></div></div> : <div className="insights-empty"><div className="insight-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core"><BrainCircuit size={25}/></div><span className="orbit-spark spark-one">✦</span><span className="orbit-spark spark-two">✧</span></div><h3>{analysisState === "loading" ? "Reading your image…" : "Your image, understood"}</h3><p>{aiConfigured ? "Get a description, ask a question, and review cautious visual clues about possible AI generation." : "Connect a hosted API backend and set its OpenRouter key to enable image descriptions and AI-origin assessment."}</p>
                <div className="insight-placeholder"><div><span className="placeholder-icon"><Sparkles size={15}/></span><span><strong>Image description</strong><small>A concise summary of the scene</small></span></div><div><span className="placeholder-icon"><Fingerprint size={15}/></span><span><strong>AI-origin assessment</strong><small>Signals and uncertainty, not a guarantee</small></span></div><div><span className="placeholder-icon"><CircleHelp size={15}/></span><span><strong>Ask about the image</strong><small>Explore objects, details, and context</small></span></div></div>
                {analysisError && <div className="inline-error"><AlertCircle size={14}/>{analysisError}</div>}
                <label className="question-field"><span>Ask a question <small>(optional)</small></span><textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="What objects or details stand out?" rows={2}/></label>
                {!aiConfigured && <div className="setup-notice"><AlertCircle size={14}/><span>Set <code>OPENROUTER_API_KEY</code> in the backend environment. Use <code>OPENROUTER_VISION_MODELS</code> to configure fallback models.</span></div>}
              </div>}
              <div className="panel-foot"><span><StatusDot ok={aiConfigured}/> {aiConfigured ? `OpenRouter · ${models.length} routes` : "Waiting for OpenRouter key"}</span><span>HELIX NEBULA · STUDIO</span></div>
            </section>
          </div> : <div className="measure-layout">
            <section className="panel measure-upload"><div className="panel-head"><div><span className="panel-kicker">01 / CAPTURE</span><h2>Product photos</h2></div><span className="panel-meta">{photos.length} / 30 photos · min 5</span></div>
              <div className="measure-drop"><div className="upload-icon"><CloudUpload size={24}/></div><h3>Upload overlapping views</h3><p>Walk around one stationary product and capture each angle with 60–80% overlap. Keep focus and lighting steady. Include a ruler or known-size reference for real dimensions.</p><button className="primary-btn" onClick={() => multiInput.current?.click()}><Upload size={15}/> Add product photos</button><span className="file-note">JPG, PNG, WEBP · up to 15 MB each</span><div className="capture-tips"><span><Check size={12}/> 5+ different angles</span><span><Check size={12}/> Plain, matte surfaces work best</span><span><Check size={12}/> Avoid blur and reflections</span></div></div>
              <input ref={multiInput} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => { choosePhotos([...e.target.files]); e.target.value = ""; }}/>
              {photoError && <div className="inline-error"><AlertCircle size={14}/>{photoError}</div>}
              {photos.length > 0 && <><div className="photo-grid">{photos.map((photo, index) => <div className="photo-thumb" key={`${photo.file.name}-${index}`}><img src={photo.url} alt={`Product view ${index + 1}`}/><span>View {index + 1}</span><button onClick={() => removePhoto(index)} aria-label="Remove photo"><X size={12}/></button></div>)}</div><button className="clear-photos" onClick={clearPhotos}><X size={13}/> Clear all photos</button></>}
              {jobStatus && <div className={`job-message ${jobStatus === "failed" ? "job-failed" : ""}`}><span className="job-status-icon">{["queued", "processing"].includes(jobStatus) ? <LoaderCircle className="spin" size={16}/> : jobStatus === "completed" ? <Check size={16}/> : <AlertCircle size={16}/>}</span><div><strong>{jobStatus}</strong><p>{jobMessage}</p></div></div>}
              <button className="analyze-btn" disabled={busy || photos.length < 5 || colmap !== "ready"} onClick={uploadPhotos}><Box size={16}/>{busy ? "Preparing reconstruction…" : "Build 3D reconstruction"}<ArrowUpRight size={15}/></button><p className="privacy-note"><ShieldCheck size={13}/> Photos are uploaded to the connected reconstruction backend.</p>
            </section>
            <section className="panel reconstruction-panel"><div className="panel-head"><div><span className="panel-kicker">02 / MODEL</span><h2>3D reconstruction</h2></div><span className="result-status"><span/> {colmap === "ready" ? "Engine ready" : "Engine unavailable"}</span></div>
              {modelData ? <div className="model-result"><div className="model-result-head"><div><h3>{demoMode ? "Sample product · ceramic mug" : modelData.triangles?.length ? "Reconstructed surface mesh" : "Reconstructed point cloud"}</h3><p>{demoMode ? "Interactive example · synthetic geometry, not from your photos" : `${modelData.source_point_count.toLocaleString()} points · ${modelData.triangles?.length ? `${modelData.triangles.length.toLocaleString()} surface faces previewed` : "surface mesh unavailable; showing points"}`}</p></div>{!demoMode && <a className="secondary-btn model-download" href={`${API}/api/measurement/${jobId}/model/download`}><Download size={14}/> Download PLY</a>}</div><PointCloudViewer model={modelData} selected={pickedPoints.map(point => point.index)} onSelect={selectCalibrationPoint}/><p className="viewer-hint">Drag horizontally for a full 360° orbit · wheel to zoom · click two points to calibrate</p><label className="scale-input"><span><Ruler size={14}/> Known distance between selected points</span><div><input type="number" min="0.01" step="any" value={knownDistance} onChange={event => setKnownDistance(event.target.value)} placeholder="Distance in cm"/><span>cm</span></div></label><p className="selection-hint">{pickedPoints.length === 0 ? "Select a point, then select a second point in the viewer." : pickedPoints.length === 1 ? "First point selected. Select the second point." : "Two points selected. Enter their measured distance to calculate dimensions."}</p>{calibration && <div className="dimension-results"><div className="dimension-results-head"><span>Estimated product dimensions</span><small>Approximate · centimeters</small></div><div className="dimension-cards">{[["Length", calibration.length], ["Width", calibration.width], ["Height", calibration.height]].map(([label, value]) => <div className="dimension-card" key={label}><span>{label}</span><strong>{value.toFixed(2)} <small>cm</small></strong></div>)}</div></div>}<div className="calibration-note"><CircleHelp size={15}/><span>{demoMode ? "This sample is synthetic. For real measurements, reconstruct your product and enter the distance between two points you select." : "Dimensions are scaled from your measured point pair; the largest cloud axis is labeled length. Download the PLY to continue editing in 3D tools."}</span></div></div> : <div className="reconstruction-empty"><div className="wire-cube"><Box size={45} strokeWidth={1.2}/></div><h3>{jobStatus === "processing" || jobStatus === "queued" ? "Reconstruction in progress" : jobStatus === "failed" ? "Reconstruction failed" : "Model preview"}</h3><p>{modelError || jobMessage || (colmap === "ready" ? "Upload at least five overlapping photos to start a COLMAP reconstruction." : "Install and connect COLMAP to process product photos.")}</p><button className="demo-model-btn" onClick={openDemoModel}><Box size={14}/> Explore a sample 3D model</button><div className="engine-status"><span><Cpu size={15}/> Reconstruction engine</span><strong>{colmap.replaceAll("_", " ")}</strong></div><div className="engine-status"><span><Ruler size={15}/> Physical dimensions</span><strong>{calibration ? "Calibrated" : "Needs scale reference"}</strong></div><div className="calibration-note"><CircleHelp size={15}/><span>Photos alone produce an unscaled 3D model. After reconstruction, select two points that have a known real distance to calculate length, width, and height.</span></div></div>}
              <div className="panel-foot"><span><StatusDot ok={colmap === "ready"}/> COLMAP {colmap === "ready" ? "available" : "not available"}</span><span>3D PRODUCT MODE</span></div>
            </section>
          </div>}
          <footer className="hn-footer"><span>HELIX NEBULA <b>IMAGE STUDIO</b></span><span><span className="footer-dot"/> Local workspace <span className="footer-separator">·</span> Model results require configured AI services</span></footer>
        </main>
      </div>
    </div>
  );
}
