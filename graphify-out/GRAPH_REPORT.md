# Graph Report - vector_drawing_app  (2026-10-05)

## Corpus Check
- 64 files · ~68,035 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 846 nodes · 2326 edges · 31 communities (28 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c3be1acd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]

## God Nodes (most connected - your core abstractions)
1. `render()` - 30 edges
2. `cloneElement()` - 26 edges
3. `getRectCorners()` - 26 edges
4. `getBounds()` - 26 edges
5. `worldToScreen()` - 25 edges
6. `touchElement()` - 22 edges
7. `isDarkBackground()` - 22 edges
8. `createIdElement()` - 19 edges
9. `drawBrushElement()` - 18 edges
10. `screenToWorld()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `selectionBounds()` --calls--> `getBounds()`  [EXTRACTED]
  js/tools/select.js → js/scene/element.js
- `snap()` --calls--> `getSnappedPosition()`  [EXTRACTED]
  js/app.js → js/precision/snap.js
- `setActiveTool()` --calls--> `setBrush()`  [EXTRACTED]
  js/app.js → js/brush/active-brush.js
- `setActiveTool()` --calls--> `isEditingText()`  [EXTRACTED]
  js/app.js → js/tools/text.js
- `clearDrawing()` --calls--> `onSceneMutated()`  [EXTRACTED]
  js/app.js → js/math/pipeline.js

## Import Cycles
- None detected.

## Communities (31 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (102): setBrush(), subscribeStyle(), displayedTextSize(), isEditingText(), setTextSize(), closeColorPicker(), isColorPickerOpen(), isEyedropperActive() (+94 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (53): annularSectorPathD(), annulusPathD(), ARC_G, ARC_LIGHT, ARC_R_MID, ARC_R_TOP, ARC_SAT, arcDegToValue() (+45 more)

### Community 2 - "Community 2"
Cohesion: 0.23
Nodes (18): alloc(), boundsOf(), dab(), flush(), GRADE, graphiteReach(), growToFit(), hh() (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (24): brushCacheStats(), app, canvas, ctx, debugOverlayVisible, dimsSel, drawDebugOverlay(), dropTouch() (+16 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (34): screenToWorld(), cornerRing(), dropCollinear(), hasSharpCorners(), interiorAngle(), makeRectElement(), mergeCloseCorners(), perpDistance() (+26 more)

### Community 5 - "Community 5"
Cohesion: 0.11
Nodes (15): bump(), revs, touchElement(), touchScene(), translateElement(), snap(), TransformCommand, distToSegment() (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (66): blit(), boundsOf(), drawBrushElement(), elementPolyline(), entries, evictIfNeeded(), invalidateBrush(), layout() (+58 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (61): worldToScreen(), activePage(), drawEraser(), drawSliceBlade(), frameLoop(), pageScreenRect(), render(), traceSlice() (+53 more)

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (19): clamp01(), comfortableStep(), deviceX(), deviceY(), dotTile(), dotTileCache, drawDotGrid(), drawGraphGrid() (+11 more)

### Community 9 - "Community 9"
Cohesion: 0.22
Nodes (15): applyCurvature(), applyTaper(), buildNodes(), clamp(), crSegment(), dedupe(), densify(), dynAlpha() (+7 more)

### Community 10 - "Community 10"
Cohesion: 0.16
Nodes (12): activeBrush, emit(), listeners, commit(), doubleTapConsumed(), editCommitted(), editShape(), handleDoubleTap() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (6): view, deserializeProject(), pickFile(), readFileText(), serializeProject(), setWorkspaceMode()

### Community 12 - "Community 12"
Cohesion: 0.29
Nodes (10): clamp01(), hasRealPressure(), sample(), samplesFrom(), brushRadiusWorld(), freshSamples(), markTouched(), sliceTool (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (36): addOctave(), clamp255(), drawBackground(), getPattern(), isPaperFlat(), makeCheckerTile(), makeGrainTile(), mulberry32() (+28 more)

### Community 14 - "Community 14"
Cohesion: 0.25
Nodes (11): brushToStyle(), bboxOfPoints(), defaultStyle(), distPointToSegment(), hitTest(), hitTestBody(), holdsCenteredText(), pointInRing() (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.24
Nodes (16): applyErase(), commitErase(), densify(), distToSegment(), ERASER_RANGE, eraserRadiusWorld(), eraserTool, eraseStep() (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (27): beginBrushFrame(), getVisibleWorldBounds(), drawCommitted(), drawLivePreview(), drawScene(), drawTexts(), onScreen(), recognizedColor() (+19 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (15): bindable(), createScaleSettings(), niceNumber(), niceScaleBarLength(), scaleBinding, setDimensionMode(), setUnit(), setUnitsPerWorldUnit() (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.21
Nodes (22): arithmeticResult(), canEvaluate(), evalNumeric(), evaluateArithmetic(), evalWithX(), formatResult(), functionExpr(), hasFreeVariable() (+14 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (51): aabbGap(), clusterPathElements(), mathLikeness(), mergeGapWorld(), unionBoundsOf(), fingerprintElements(), fnv1a(), hitOverlayAction() (+43 more)

### Community 20 - "Community 20"
Cohesion: 0.45
Nodes (10): axisMargin(), clamp(), clampAxis(), constrainView(), fitToBounds(), pageMinZoom(), panBy(), viewportSize() (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (3): intersectsBounds(), History, StyleCommand

### Community 22 - "Community 22"
Cohesion: 0.36
Nodes (6): get_engine(), lifespan(), Thin Pix2Text wrapper for region crops from the drawing app.  POST /math/recogni, recognize(), RecognizeBody, BaseModel

### Community 23 - "Community 23"
Cohesion: 0.36
Nodes (8): applyViewTransform(), getCanvas(), getContext(), resetToScreenSpace(), resizeCanvas(), ensure(), sampleScreen(), beginFrame()

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (6): setActiveTool(), getTool(), listTools(), order, registerTool(), registry

### Community 29 - "Community 29"
Cohesion: 0.20
Nodes (4): AddManyCommand, cloneElement(), AddElementCommand, EraseCommand

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (37): BRUSH_PRESETS, getBrushPreset(), isFilledMedium(), LEGACY_IDS, widthRangeFor(), cases(), flat(), installBrushTestbed() (+29 more)

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (7): setPageConstraint(), clearDrawing(), enterDocument(), hasDrawingContent(), showHome(), syncPanelFromSettings(), syncWorkspacePanel()

## Knowledge Gaps
- **67 isolated node(s):** `canvas`, `ctx`, `scene`, `history`, `interaction` (+62 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Scene` connect `Community 31` to `Community 21`, `Community 3`, `Community 5`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `worldToScreen()` connect `Community 7` to `Community 3`, `Community 4`, `Community 5`, `Community 19`, `Community 20`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `cloneElement()` connect `Community 29` to `Community 3`, `Community 5`, `Community 10`, `Community 11`, `Community 12`, `Community 14`, `Community 15`, `Community 19`, `Community 31`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `Thin Pix2Text wrapper for region crops from the drawing app.  POST /math/recogni`, `canvas`, `ctx` to the rest of the system?**
  _68 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.051344286781179985 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08754208754208755 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07741935483870968 - nodes in this community are weakly interconnected._