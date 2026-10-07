# Vector Drawing App

A static browser canvas app for drawing on a paper-like page. The title in `index.html` is Vector Drawing App, Concepts-like. It is a pure front end: ES modules under `js/`, CSS under `css/`, and no framework.

## Run locally

The app loads `./js/app.js` as an ES module. Browsers block those imports on `file://`, so open the page from a local static server. From the repo root:

```bash
python3 -m http.server
```

Then open `http://localhost:8000/`.

Or:

```bash
npx serve
```

Then open the URL that command prints. Either way, use `index.html` on that origin.

There is nothing to install for the app itself, and no build step. `npx serve` only fetches the `serve` package so it can host the files.

## Using the app

A gear button opens the settings panel. A segmented switch at the top picks the workspace. Switching modes does not change the drawing. The same scene opens in either mode. What changes is which controls and overlays are shown.

**Draw** is the sketching workspace: paper colour and texture, grid, brushes, and the project actions.

**Engineer** keeps those and adds real-world units (meters, millimeters, centimeters, feet, inches), a scale ("1 unit ="), dimension display (CAD, labels, or off), and artboards. The measurement layer, including the scale bar and dimension overlays, is drawn only in this mode.

A floating style wheel picks the tool, stroke size, opacity, smoothing, and colour. Drawing tools can also pick a brush medium: Pencil, Pen, Soft Paint, Fountain Pen, Marker, or Fill.

Tools, with their keyboard keys:

| Key | Tool | What it does |
| --- | --- | --- |
| V | Select | Click or marquee to select. Move, scale, and rotate with the box handles. |
| L | Line | Drag a straight line. |
| R | Rect | Drag a rectangle. |
| C | Circle | Drag a circle. |
| P | Pen | Freehand stroke. Holding still briefly tries to recognize a cleaner shape. |
| N | Nudge | Drag part of a stroke to bend it locally. |
| S | Slice | Drag across an object to mark it, then release to delete the whole object. |
| E | Eraser | Rub out ink under a disc the size of the current brush. |

The default tool is Line. Line, rectangle, and circle snap to the grid while you drag.

**Math assist** is a panel toggle, on by default. After a short pause, pen strokes that look like math are sent as an image to `http://127.0.0.1:8787/math/recognize`. That recognizer is not part of this repo. If nothing is listening there, the app stays quiet and leaves the ink alone. When a region comes back, simple arithmetic and linear equations are evaluated in the browser and an overlay can be drawn on top of the strokes. The strokes are not rewritten. Double-click a math region to edit the expression.

**Save**, **Open**, and **SVG** are in the Project section of the panel.

- Save downloads `drawing.vda`, a JSON project (`format: "vda"`). It stores the view, scale, paper and grid appearance, workspace mode, brush, artboards, elements, and math state. Undo history is not saved.
- Open reads a `.vda` file (or JSON) back into the canvas and clears the undo history.
- SVG downloads `drawing.svg`. If an artboard exists, the export is cropped to the first one. Brush texture is not reproduced; strokes export as plain SVG outlines (fills export as filled shapes).

**Zoom to fit** frames the drawing. In Engineer mode, **Add at view** adds an artboard around the current contents (or a default rectangle if the canvas is empty).

### Shortcuts

These match the list in the settings panel:

| Action | Shortcut |
| --- | --- |
| Pan | Space-drag, or middle-drag |
| Zoom | Mouse wheel (toward the cursor) |
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z (Ctrl+Y also redoes) |
| Delete selection | Del (Backspace does the same when you are not typing in a field) |
| Duplicate selection | Ctrl+D |
| Measure | Double-click a shape (Engineer mode only) |

On macOS, use Cmd in place of Ctrl. Letter keys switch tools when you are not typing in a field. A finger pans; two fingers pinch-zoom. A finger does not draw.

Escape closes the measurement dialog and the math expression editor.

## Layout

```
index.html          Main app. Loads css/ and js/app.js.
paper-lab.html      Separate paper test page. Not the app.
css/app.css         Canvas, panel, and dialog styles.
css/style-wheel.css Style wheel styles.
js/app.js           Entry module: input, tools, panel, render loop.
js/core/            Canvas element and pan/zoom view.
js/scene/           Elements, selection, and undo history.
js/tools/           Select, line, rect, circle, pen, nudge, slice, eraser.
js/brush/           Brush presets and the stroke engine.
js/render/          Paper, grid, ink, selection, guides, and dimensions.
js/ui/              Style wheel, colour picker, panel, and dialogs.
js/workspace/       Draw / Engineer mode and paper appearance.
js/precision/       Units, snapping, and measurement editing.
js/io/              .vda save/load and SVG export.
js/math/            Math recognition, evaluation, and overlays.
```

## paper-lab.html

`paper-lab.html` is a lab page titled "PaperSurface Test Sheet". It is not part of the drawing app. It does not load `js/app.js`. The page is self-contained: a sample sheet, a WebGL paper shader, and sliders for grain, fibers, stains, and ink, so you can tune the paper look on its own.

## No build

There is no `package.json`, no bundler, and no compile step. Edit the HTML, CSS, and JS files and refresh the page served from the repo root.
