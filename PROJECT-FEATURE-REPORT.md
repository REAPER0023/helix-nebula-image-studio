# Helix Nebula — Feature & Technology Report

A short guide to what the app does, how each feature works, and why it is included.

## Features

| Feature | What it does | How it works | Why it helps |
|---|---|---|---|
| Image upload and preview | Accepts JPG, PNG, or WEBP images up to 15 MB. | The React UI checks the file and shows a browser preview; the FastAPI backend validates it again. | Makes it easy to confirm the right image and rejects unsupported files. |
| Image summary and Q&A | Describes the scene and answers an optional question. | The UI sends the image and question to FastAPI; the backend sends the image to an OpenRouter vision model. | Gives a quick description and lets users ask about specific details. |
| AI-origin clues | Gives a cautious estimate about whether an image may be AI-generated. | The prompt asks the vision model to cite visible clues and state uncertainty. | Provides context while avoiding a claim of proven image origin. |
| Free model fallback | Tries four image-capable free models in order. | The backend accepts only explicit free model IDs and retries after provider errors or incomplete answers. | Keeps AI analysis on free routes and helps when one provider is busy. |
| Copy or download analysis | Saves the current image analysis as text or copies it to the clipboard. | The browser uses the Clipboard API and a generated text file. | Makes results easy to keep or share. |
| Multi-photo 3D reconstruction | Builds a product point cloud or mesh from 5–30 overlapping photos. | FastAPI stores the photos and runs the local COLMAP photogrammetry engine. | Combines multiple views into a model that can be inspected from different angles. |
| 360° model viewer | Rotates and zooms the reconstructed model. | A custom browser Canvas viewer projects the model points and updates its rotation as the user drags. | Makes it possible to inspect the product without a separate 3D app. |
| Dimension calibration | Estimates length, width, and height in centimeters. | The user selects two model points and enters their known real-world distance; the model is scaled from that reference. | Converts a model with no known scale into approximate physical dimensions. |
| PLY model download | Exports a reconstructed model for other 3D tools. | The backend returns the generated PLY file. | Lets users continue editing or inspecting the model elsewhere. |
| Sample 3D demo | Shows a sample ceramic mug in the 3D viewer. | The browser builds synthetic geometry for the demonstration. | Demonstrates viewer controls without requiring a reconstruction job. |
| Service status and file checks | Shows whether the API, AI key, and COLMAP are ready. | The UI polls backend health/status endpoints; upload endpoints enforce format, size, and photo-count limits. | Helps users see setup status and catch invalid inputs early. |

## Technology used

- **React** builds the interactive single-page interface; **Vite** runs the development server and builds the frontend.
- **CSS** styles the responsive dark interface; **Lucide React** supplies interface icons.
- **Python FastAPI** handles image analysis, uploads, reconstruction jobs, status checks, and downloads.
- **OpenRouter** provides the vision chat-completions API. The configured routes are `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free`, `nvidia/nemotron-3.5-super-vl:free`, and `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`.
- **COLMAP** performs photogrammetry locally; the frontend Canvas viewer renders and rotates the resulting point data.

## Important limits

- AI-origin output is an estimate from image appearance, not proof of provenance.
- Photos alone do not establish real-world scale. Dimension results need a known distance between two selected points and are approximate.
- The sample mug model is synthetic and is not reconstructed from an uploaded photo.
- Image descriptions send the selected image to OpenRouter. The API key stays in the backend environment file.
- Free model providers can be rate-limited; the app attempts the next configured free route.