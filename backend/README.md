# Math recognition backend

Open-source formula OCR via [Pix2Text](https://github.com/breezedeus/Pix2Text). The drawing app posts a cropped region PNG; this service returns LaTeX.

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787
```

The first request downloads model weights. Then serve the site from the project root (`python3 -m http.server`) and draw with the pen. Math assist is on by default.
