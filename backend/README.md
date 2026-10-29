# OpenRouter vision setup

1. Create an API key at [OpenRouter](https://openrouter.ai/keys).
2. Copy `.env.example` to `.env` in this folder and set `OPENROUTER_API_KEY`.
3. Start the API from this folder with `python -m uvicorn main:app --reload --port 8001`.
4. Start the frontend with `npm run dev` from `frontend/`.

The API key remains on the backend. The selected image is sent to OpenRouter for analysis. The default route uses `openrouter/free`, which selects a free model that supports the request's image input. If a request fails, the backend tries the remaining model IDs in `OPENROUTER_VISION_MODELS`, in order. You can replace that comma-separated list with other OpenRouter vision models.

Free models have provider-side capacity and rate limits. An OpenRouter API key is required, and a free model may still be temporarily unavailable. AI-origin assessment is a visual estimate; it cannot establish provenance.

## Product reconstruction

Upload at least five overlapping photos of the same object. The studio guides you toward varied angles, overlap, steady focus, and a rigid scale reference. After COLMAP finishes, it creates a dense surface mesh when available and falls back to a point cloud when meshing is unavailable. You can orbit, zoom, and download the PLY model. To estimate real-world dimensions, select two points with a known distance between them, then enter that distance in centimeters. The displayed length, width, and height are approximate bounds; use a rigid scale reference and even lighting for better results. COLMAP reconstruction is unscaled until this calibration step.

The 3D workspace also includes a synthetic sample mug so you can try the orbit, zoom, point selection, and scale calibration controls without uploading product photos. Its geometry is only a UI demo and does not represent a reconstruction.
