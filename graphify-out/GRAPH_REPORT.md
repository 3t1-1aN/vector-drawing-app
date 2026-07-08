# Graph Report - vector_drawing_app  (2026-07-07)

## Corpus Check
- 23 files · ~14,766 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 234 nodes · 570 edges · 14 communities (9 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4e0c07a8`
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

## God Nodes (most connected - your core abstractions)
1. `getRectCorners()` - 20 edges
2. `render()` - 19 edges
3. `cloneElement()` - 19 edges
4. `Scene` - 17 edges
5. `createIdElement()` - 14 edges
6. `worldToScreen()` - 13 edges
7. `lineLength()` - 13 edges
8. `screenToWorld()` - 12 edges
9. `rectSize()` - 10 edges
10. `edgeLengths()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `snap()` --calls--> `getSnappedPosition()`  [INFERRED]
  js/app.js → js/precision/snap.js
- `restoreSnapshots()` --calls--> `cloneElement()`  [EXTRACTED]
  js/tools/select.js → js/scene/element.js
- `render()` --calls--> `drawCadDimensions()`  [EXTRACTED]
  js/app.js → js/render/dimensions.js
- `render()` --calls--> `drawLiveCadDimension()`  [EXTRACTED]
  js/app.js → js/render/dimensions.js
- `render()` --calls--> `drawGrid()`  [EXTRACTED]
  js/app.js → js/render/grid.js

## Import Cycles
- None detected.

## Communities (14 total, 5 thin omitted)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (42): applyViewTransform(), getCanvas(), getContext(), resetToScreenSpace(), resizeCanvas(), view, deserializeProject(), pickFile() (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.17
Nodes (7): bboxOfPoints(), getBounds(), translateElement(), restoreSnapshots(), selectionBounds(), selectTool, state

### Community 3 - "Community 3"
Cohesion: 0.20
Nodes (16): clamp(), fitToBounds(), getVisibleWorldBounds(), panBy(), zoomAt(), edgeLengths(), interiorAngle(), makeRectElement() (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (26): screenToWorld(), createIdElement(), defaultStyle(), distPointToSegment(), hitTest(), isDegenerate(), nextId(), segmentsOf() (+18 more)

### Community 5 - "Community 5"
Cohesion: 0.27
Nodes (18): worldToScreen(), formatLength(), drawAlignedDim(), drawArrow(), drawCadDimensions(), drawDiameterDim(), drawElementDims(), drawLiveCadDimension() (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (31): downloadText(), elementToSvg(), esc(), exportSvg(), ptsToStr(), applyMeasurements(), applyTriangleSide(), getEditableFields() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.38
Nodes (6): intersections(), segIntersect(), sliceTool, splitPathAtCuts(), state, subPath()

### Community 10 - "Community 10"
Cohesion: 0.32
Nodes (3): cloneElement(), AddElementCommand, SliceCommand

### Community 11 - "Community 11"
Cohesion: 0.48
Nodes (6): snap(), getSnappedPosition(), objectSnapPoints(), perpFoot(), segmentSnapPoints(), segmentsOf()

## Knowledge Gaps
- **18 isolated node(s):** `canvas`, `ctx`, `scene`, `history`, `interaction` (+13 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Scene` connect `Community 9` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `cloneElement()` connect `Community 10` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `History` connect `Community 0` to `Community 1`, `Community 12`, `Community 9`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **What connects `canvas`, `ctx`, `scene` to the rest of the system?**
  _18 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06711915535444947 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.10887096774193548 - nodes in this community are weakly interconnected._
- **Should `Community 6` be split into smaller, more focused modules?**
  _Cohesion score 0.10634920634920635 - nodes in this community are weakly interconnected._