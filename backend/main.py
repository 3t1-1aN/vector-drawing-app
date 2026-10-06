"""Thin Pix2Text wrapper for region crops from the drawing app.

POST /math/recognize  { "image": "data:image/png;base64,..." }
  -> { "latex": "...", "ascii": "...", "confidence": 0.8 }
"""

import base64
import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from pix2text import Pix2Text

        # Formula-only. Weights download on first load.
        _engine = Pix2Text.from_config(enable_formula=True, enable_table=False)
    return _engine


@asynccontextmanager
async def lifespan(_app):
    get_engine()
    yield


app = FastAPI(title="vector-drawing math", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class RecognizeBody(BaseModel):
    image: str


@app.get("/health")
def health():
    return {"ok": True, "ready": _engine is not None}


@app.post("/math/recognize")
def recognize(body: RecognizeBody):
    raw = body.image.strip()
    if not raw:
        raise HTTPException(400, "missing image")
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        png = base64.b64decode(raw)
        img = Image.open(io.BytesIO(png)).convert("RGB")
    except Exception as exc:
        raise HTTPException(400, f"bad image: {exc}") from exc

    try:
        latex = get_engine().recognize_formula(img)
    except Exception as exc:
        raise HTTPException(500, f"recognize failed: {exc}") from exc

    if isinstance(latex, (list, tuple)):
        latex = latex[0] if latex else ""
    latex = str(latex or "").strip().strip("$")
    if not latex:
        return {"latex": "", "ascii": "", "confidence": 0}
    return {"latex": latex, "ascii": latex, "confidence": 0.8}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787)
