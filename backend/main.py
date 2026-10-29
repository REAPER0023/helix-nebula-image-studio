
import asyncio
from array import array
import base64
import json
import mimetypes
import os
import shutil
import struct
import subprocess
import threading
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse


def load_backend_env():
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip().strip("\"'")
        os.environ.setdefault(name.strip(), value)


load_backend_env()

app = FastAPI(
    title="Helix Nebula API",
    description="Image processing and multi-view 3D reconstruction",
    version="1.0.0",
)

COLMAP_PATH = os.getenv("COLMAP_EXE") or shutil.which("colmap")
COLMAP_EXE = Path(COLMAP_PATH) if COLMAP_PATH else Path("colmap")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
IMAGE_DIR = DATA_DIR / "images"
OUTPUT_DIR = DATA_DIR / "reconstructions"

IMAGE_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILES = 30
MAX_FILE_SIZE = 15 * 1024 * 1024
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_VISION_MODELS = (
    "google/gemma-4-26b-a4b-it:free,google/gemma-4-31b-it:free,"
    "nvidia/nemotron-3.5-super-vl:free,"
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
)


def vision_models():
    configured = os.getenv("OPENROUTER_VISION_MODELS", DEFAULT_VISION_MODELS)
    models = [model.strip() for model in configured.split(",") if model.strip()]
    safe_models = [
        model for model in models
        if not model.lower().startswith(("sk-or-v1-", "sk-"))
        and (model == "openrouter/free" or model.endswith(":free"))
    ]
    return safe_models or [model for model in DEFAULT_VISION_MODELS.split(",") if model]


def request_openrouter(image_bytes: bytes, content_type: str, question: str):
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OpenRouter is not configured. Set OPENROUTER_API_KEY in the backend environment.",
        )

    image_data = base64.b64encode(image_bytes).decode("ascii")
    user_prompt = (
        "Describe the visible image in 2–3 complete, concise sentences. Identify notable objects and scene details. "
        "Then give a cautious assessment of whether it may be AI-generated, citing visible clues and "
        "stating uncertainty; image appearance alone cannot prove origin. End with complete sentences. "
        f"User question: {question.strip() or 'Summarize and describe this image.'}"
    )
    errors = []
    for model in vision_models():
        payload = json.dumps({
            "model": model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {
                        "url": f"data:{content_type};base64,{image_data}"
                    }},
                ],
            }],
            "max_tokens": 700,
        }).encode("utf-8")
        request = Request(
            OPENROUTER_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "Helix Nebula Image Studio",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))
            choice = result["choices"][0]
            text = choice["message"]["content"]
            if isinstance(text, list):
                text = "\n".join(part.get("text", "") for part in text if isinstance(part, dict))
            if not text or not text.strip():
                raise ValueError("The model returned an empty response.")
            clean_text = text.strip()
            punctuation_check = clean_text.rstrip("*_` ")
            if choice.get("finish_reason") not in {None, "stop"} or not punctuation_check.endswith((".", "!", "?", "…")):
                raise ValueError("The model returned an incomplete response.")
            return {"model": model, "response": text}
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")[:500]
            errors.append(f"{model}: HTTP {exc.code} {body}")
            if exc.code not in {400, 404, 408, 429, 500, 502, 503, 504}:
                break
        except (URLError, TimeoutError, ValueError, KeyError, IndexError) as exc:
            errors.append(f"{model}: {exc}")

    raise HTTPException(
        status_code=502,
        detail="All configured OpenRouter vision models are busy or unavailable. " + " | ".join(errors),
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "https://reaper0023.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs = {}
jobs_lock = threading.Lock()


@app.get("/")
def home():
    return {
        "project": "Helix Nebula",
        "status": "online",
        "message": "Image processing API is running.",
    }


@app.get("/api/health")
def health():
    return {"status": "healthy"}


@app.get("/api/ai/status")
def ai_status():
    return {
        "provider": "OpenRouter",
        "configured": bool(os.getenv("OPENROUTER_API_KEY", "").strip()),
        "models": vision_models(),
    }


@app.post("/api/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    question: str = Form(default=""),
):
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG, or WEBP image.")

    image_bytes = await file.read(MAX_FILE_SIZE + 1)
    await file.close()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The image is empty.")
    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Images must be 15 MB or smaller.")

    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0]
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Unsupported image format.")

    result = await asyncio.to_thread(request_openrouter, image_bytes, content_type, question[:1000])
    return {"provider": "OpenRouter", **result}


@app.get("/api/colmap/status")
def colmap_status():
    if not COLMAP_EXE.is_file():
        return {
            "status": "not_found",
            "path": str(COLMAP_EXE),
        }

    try:
        result = subprocess.run(
            [str(COLMAP_EXE), "-h"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return {
            "status": "installed",
            "version_info": (result.stdout + result.stderr)[:500],
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/api/measurement/upload")
async def upload_images(files: list[UploadFile] = File(...)):
    if not 3 <= len(files) <= MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Upload between 3 and {MAX_FILES} photos.",
        )

    job_id = uuid.uuid4().hex
    job_dir = IMAGE_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=False)

    saved = []

    try:
        for index, file in enumerate(files, start=1):
            extension = Path(file.filename or "").suffix.lower()

            if extension not in ALLOWED_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported image: {file.filename}",
                )

            target = job_dir / f"image_{index:03d}{extension}"
            size = 0

            with target.open("wb") as output:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_FILE_SIZE:
                        raise HTTPException(
                            status_code=413,
                            detail=f"{file.filename} exceeds 15 MB.",
                        )
                    output.write(chunk)

            if size == 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"{file.filename} is empty.",
                )

            saved.append(target.name)

        with jobs_lock:
            jobs[job_id] = {
                "status": "uploaded",
                "image_count": len(saved),
                "output_dir": str(OUTPUT_DIR / job_id),
                "message": "Photos saved; ready for reconstruction.",
            }

        return {
            "job_id": job_id,
            "status": "uploaded",
            "image_count": len(saved),
            "images": saved,
            "message": "Photos uploaded successfully.",
        }

    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    finally:
        for file in files:
            await file.close()


def run_reconstruction(job_id: str):
    image_path = IMAGE_DIR / job_id
    workspace = OUTPUT_DIR / job_id
    workspace.mkdir(parents=True, exist_ok=True)

    with jobs_lock:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["message"] = "COLMAP is processing the photos."

    try:
        # COLMAP's automatic pipeline attempts sparse and dense
        # reconstruction. Success depends on image quality and matching.
        result = subprocess.run(
            [
                str(COLMAP_EXE),
                "automatic_reconstructor",
                "--image_path", str(image_path),
                "--workspace_path", str(workspace),
                "--quality", "medium",
                "--use_gpu", "0",
            ],
            capture_output=True,
            text=True,
            timeout=3600,
        )

        model_root = workspace / "sparse"
        model_dirs = sorted(
            [path for path in model_root.iterdir() if path.is_dir()]
            if model_root.exists() else [],
            key=lambda path: (not (path / "points3D.bin").is_file(), path.name),
        )
        model_dir = model_dirs[0] if model_dirs else None
        model_exists = model_dir is not None and (
            (model_dir / "points3D.bin").is_file()
            or (model_dir / "points3D.txt").is_file()
        )

        if result.returncode == 0 and model_exists:
            ply_path = workspace / "preview.ply"
            model_kind = "point_cloud"
            dense_cloud = workspace / "dense" / "0" / "fused.ply"
            if dense_cloud.is_file():
                ply_path = dense_cloud
                mesh_path = workspace / "dense" / "0" / "meshed.ply"
                try:
                    meshed = subprocess.run(
                        [
                            str(COLMAP_EXE), "delaunay_mesher",
                            "--input_path", str(workspace / "dense"),
                            "--output_path", str(mesh_path),
                        ],
                        capture_output=True,
                        text=True,
                        timeout=900,
                    )
                    if meshed.returncode == 0 and mesh_path.is_file():
                        ply_path = mesh_path
                        model_kind = "surface_mesh"
                except subprocess.TimeoutExpired:
                    pass
            else:
                converted = subprocess.run(
                    [
                        str(COLMAP_EXE), "model_converter",
                        "--input_path", str(model_dir),
                        "--output_path", str(ply_path),
                        "--output_type", "PLY",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if converted.returncode != 0 or not ply_path.is_file():
                    raise RuntimeError(
                        converted.stderr[-1500:]
                        or "COLMAP could not export a point cloud preview."
                    )
            with jobs_lock:
                jobs[job_id]["status"] = "completed"
                jobs[job_id]["message"] = (
                    "Reconstruction finished. Select two points and enter their known distance to scale the model."
                )
                jobs[job_id]["model_directory"] = str(model_dir)
                jobs[job_id]["preview_path"] = str(ply_path)
                jobs[job_id]["model_kind"] = model_kind
        else:
            with jobs_lock:
                jobs[job_id]["status"] = "failed"
                jobs[job_id]["message"] = (
                    result.stderr[-2000:]
                    or result.stdout[-2000:]
                    or "COLMAP did not produce a sparse model."
                )

    except subprocess.TimeoutExpired:
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["message"] = "Reconstruction exceeded one hour."
    except (OSError, RuntimeError) as exc:
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["message"] = str(exc)


@app.post("/api/measurement/{job_id}/reconstruct")
def start_reconstruction(job_id: str):
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail="Unknown job ID.")

        if jobs[job_id]["status"] not in {"uploaded", "failed"}:
            raise HTTPException(
                status_code=409,
                detail="This job cannot be started in its current state.",
            )

        if not COLMAP_EXE.is_file():
            raise HTTPException(
                status_code=503,
                detail="COLMAP executable was not found.",
            )

        jobs[job_id]["status"] = "queued"

    thread = threading.Thread(
        target=run_reconstruction,
        args=(job_id,),
        daemon=True,
    )
    thread.start()

    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Reconstruction started. Check the job status endpoint.",
    }


@app.get("/api/measurement/{job_id}/status")
def reconstruction_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)

        if job is None:
            raise HTTPException(status_code=404, detail="Unknown job ID.")

        return {"job_id": job_id, **job}


@app.get("/api/measurement/{job_id}/model")
def reconstruction_model(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Unknown job ID.")
        if job.get("status") != "completed":
            raise HTTPException(status_code=409, detail="The reconstruction is not complete yet.")
        ply_path = Path(job.get("preview_path", ""))

    if not ply_path.is_file():
        raise HTTPException(status_code=404, detail="The model preview file is missing.")

    try:
        return read_ply_preview(ply_path)
    except (OSError, UnicodeError, ValueError, struct.error, KeyError, IndexError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read the model preview: {exc}") from exc


PLY_TYPE_FORMATS = {
    "char": "b", "int8": "b", "uchar": "B", "uint8": "B",
    "short": "h", "int16": "h", "ushort": "H", "uint16": "H",
    "int": "i", "int32": "i", "uint": "I", "uint32": "I",
    "float": "f", "float32": "f", "double": "d", "float64": "d",
}


def read_ply_preview(path: Path):
    with path.open("rb") as ply_file:
        header = bytearray()
        while not header.endswith(b"end_header\n"):
            line = ply_file.readline()
            if not line or len(header) > 65536:
                raise ValueError("Invalid PLY header.")
            header.extend(line)
        header_text = header.decode("ascii", errors="strict")
        file_format = next((line.split()[1] for line in header_text.splitlines() if line.startswith("format ")), "")
        if file_format not in {"ascii", "binary_little_endian"}:
            raise ValueError("Only ASCII or binary little-endian PLY previews are supported.")

        elements = []
        current = None
        for line in header_text.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[0] == "element":
                current = {"name": parts[1], "count": int(parts[2]), "properties": []}
                elements.append(current)
            elif current and parts and parts[0] == "property":
                if len(parts) == 3:
                    current["properties"].append({"kind": parts[1], "name": parts[2]})
                elif len(parts) == 5 and parts[1] == "list":
                    current["properties"].append({"list": True, "count_kind": parts[2], "item_kind": parts[3], "name": parts[4]})

        vertex_element = next((element for element in elements if element["name"] == "vertex"), None)
        face_element = next((element for element in elements if element["name"] == "face"), None)
        if not vertex_element or vertex_element["count"] < 1:
            raise ValueError("The reconstructed point cloud is empty.")
        vertex_count = vertex_element["count"]
        vertex_properties = vertex_element["properties"]
        names = [prop["name"] for prop in vertex_properties]
        if not {"x", "y", "z"}.issubset(names):
            raise ValueError("The PLY point cloud has no XYZ coordinates.")

        coordinates = [array("f"), array("f"), array("f")]
        colors = [array("B"), array("B"), array("B")]
        minima = [float("inf")] * 3
        maxima = [float("-inf")] * 3
        point_stride = max(1, (vertex_count + 19999) // 20000)
        points = []

        if file_format == "ascii":
            for index in range(vertex_count):
                values = ply_file.readline().split()
                if not values:
                    break
                numeric = [float(values[names.index(axis)]) for axis in ("x", "y", "z")]
                color = [int(values[names.index(axis)]) if axis in names else 180 for axis in ("red", "green", "blue")]
                for axis, value in enumerate(numeric):
                    coordinates[axis].append(value)
                    minima[axis] = min(minima[axis], value)
                    maxima[axis] = max(maxima[axis], value)
                for axis, value in enumerate(color):
                    colors[axis].append(max(0, min(255, value)))
                if index % point_stride == 0:
                    points.append([*numeric, *color])
        else:
            record_format = "<" + "".join(PLY_TYPE_FORMATS[prop["kind"]] for prop in vertex_properties)
            record_size = struct.calcsize(record_format)
            indices = {name: index for index, name in enumerate(names)}
            for index in range(vertex_count):
                record = ply_file.read(record_size)
                if len(record) != record_size:
                    break
                values = struct.unpack(record_format, record)
                numeric = [float(values[indices[axis]]) for axis in ("x", "y", "z")]
                color = [int(values[indices[axis]]) if axis in indices else 180 for axis in ("red", "green", "blue")]
                for axis, value in enumerate(numeric):
                    coordinates[axis].append(value)
                    minima[axis] = min(minima[axis], value)
                    maxima[axis] = max(maxima[axis], value)
                for axis, value in enumerate(color):
                    colors[axis].append(max(0, min(255, value)))
                if index % point_stride == 0:
                    points.append([*numeric, *color])

        triangles = []
        face_count = face_element["count"] if face_element else 0
        if face_element and face_count:
            face_stride = max(1, (face_count + 11999) // 12000)
            props = face_element["properties"]
            list_prop = next((prop for prop in props if prop.get("list") and prop["name"] in {"vertex_indices", "vertex_index"}), None)
            if list_prop:
                for face_index in range(face_count):
                    indices = None
                    if file_format == "ascii":
                        tokens = ply_file.readline().split()
                        cursor = 0
                        for prop in props:
                            if prop.get("list"):
                                count = int(tokens[cursor]); cursor += 1
                                values = [int(value) for value in tokens[cursor:cursor + count]]
                                cursor += count
                                if prop is list_prop:
                                    indices = values
                            else:
                                cursor += 1
                    else:
                        for prop in props:
                            if prop.get("list"):
                                count_format = "<" + PLY_TYPE_FORMATS[prop["count_kind"]]
                                count_size = struct.calcsize(count_format)
                                count_data = ply_file.read(count_size)
                                if len(count_data) != count_size:
                                    break
                                count = struct.unpack(count_format, count_data)[0]
                                item_format = "<" + PLY_TYPE_FORMATS[prop["item_kind"]]
                                item_size = struct.calcsize(item_format)
                                values_data = ply_file.read(count * item_size)
                                if len(values_data) != count * item_size:
                                    break
                                if prop is list_prop:
                                    indices = [item[0] for item in struct.iter_unpack(item_format, values_data)]
                            else:
                                scalar_format = "<" + PLY_TYPE_FORMATS[prop["kind"]]
                                ply_file.read(struct.calcsize(scalar_format))
                    if indices and len(indices) >= 3 and face_index % face_stride == 0:
                        for offset in range(1, len(indices) - 1):
                            triangle_indices = (indices[0], indices[offset], indices[offset + 1])
                            if any(index < 0 or index >= len(coordinates[0]) for index in triangle_indices):
                                continue
                            flattened = []
                            for index in triangle_indices:
                                flattened.extend(coordinates[axis][index] for axis in range(3))
                            color = [sum(colors[axis][index] for index in triangle_indices) // 3 for axis in range(3)]
                            triangles.append([*flattened, *color])

        if not points:
            raise ValueError("No 3D points could be read from the reconstruction.")
        return {
            "points": points,
            "triangles": triangles,
            "source_point_count": vertex_count,
            "source_face_count": face_count,
            "bounds": {"min": minima, "max": maxima},
            "units": "unscaled",
        }


@app.get("/api/measurement/{job_id}/model/download")
def download_reconstruction_model(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Unknown job ID.")
        if job.get("status") != "completed":
            raise HTTPException(status_code=409, detail="The reconstruction is not complete yet.")
        ply_path = Path(job.get("preview_path", ""))
    if not ply_path.is_file():
        raise HTTPException(status_code=404, detail="The model preview file is missing.")
    return FileResponse(
        ply_path,
        media_type="application/octet-stream",
        filename="helix-nebula-3d-model.ply",
    )
