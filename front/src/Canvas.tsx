import React, { useRef, useEffect, useCallback } from "react";
import { Paper } from "@material-ui/core";
import { getRandInRange } from "./util";

export type Point = [number, number];
export type Vector = [number, number];
export interface Stroke {
  colour: string;
  brushRadius: number;
  points: Array<Point>;
  size: number;
}
type StrokeIndexes = number[];

export interface Props {
  displayedHistory: Stroke[];
  brushRadius?: number;
  brushColour?: string;
  eraseMode?: boolean;
  locked?: boolean;
  onStrokeDone?: (currentStroke: Stroke) => void;
  size?: number;
  animated?: boolean;
}

const defaultProps: any = {
  displayedHistory: [],
  brushRadius: 5,
  brushColour: "#000",
  eraseMode: false,
  locked: false,
  onStrokeDone: () => {},
  size: 400,
  animated: false,
  dragMode: false,
  onAnimDone: () => {},
  onDrag: () => {},
  onDragDone: undefined, // restore canvas if undefined
  bgColour: "#fff",
  boundingBoxDash: [5, 5],
};

/**
 * Converts client coords (mouse/touch) to canvas-rel coords
 *
 * @param {React.MutableRefObject<HTMLCanvasElement>} canvasRef the ref to the canvas
 * @param {number} x x coord rel to client
 * @param {number} x y coord rel to client
 */
function convertCoords(
  canvasRef: React.MutableRefObject<HTMLCanvasElement>,
  x: number,
  y: number
): Point {
  const rect = canvasRef.current.getBoundingClientRect();
  const canvasX = Math.floor(x - rect.left); // ts actually caught me using parseInt instead of Math.floor/toFixed... heh.
  const canvasY = Math.floor(y - rect.top);
  return [canvasX, canvasY];
}

/**
 * Draws strokes on the canvas
 * @param {CanvasRenderingContext2D | null} canvasRef The canvas' 2D context
 * @param {Stroke} stroke The stroke to draw
 * @param {number} size The current canvas size
 * @param {boolean} [lastPointOnly=true] Whether to draw the stroke's last point, or all its points
 */
const drawOnCanvas = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  size: number,
  lastPointOnly = true
) => {
  if (!stroke?.points) return;

  const ratio = size / stroke.size;
  const scale = (x: number) => Math.floor(x * ratio);
  const scalePoint = (p: Point): Point => [scale(p[0]), scale(p[1])];
  const radius = Math.max(1, scale(stroke.brushRadius));

  if (stroke.points.length === 1) {
    // draw circle at initial point
    const point = scalePoint(stroke.points[0]);
    ctx.beginPath();
    ctx.fillStyle = stroke.colour;
    ctx.arc(point[0], point[1], radius, 0, 2 * Math.PI);
    ctx.fill();
  } else {
    ctx.lineWidth = radius * 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = stroke.colour;

    ctx.beginPath();
    for (
      let i = lastPointOnly ? stroke.points.length - 2 : 0; // jump to second-last point if lastPointOnly
      i < stroke.points.length - 1;
      i++
    ) {
      const point0 = scalePoint(stroke.points[i]),
        point1 = scalePoint(stroke.points[i + 1]);
      ctx.moveTo(point0[0], point0[1]);
      ctx.lineTo(point1[0], point1[1]);
    }
    ctx.stroke();
  }
};

/**
 * Squared euclidian distance between two Points
 * @param {Point} p1 Point 1
 * @param {Point} p2 Point 2
 */
const euclideanDistSqrd = (p1: Point, p2: Point) =>
  (p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2;

/**
 * Check if a point is contained within a stroke
 * @param {Point} test The point in question
 * @param {Stroke} stroke The stroke in question
 * @param {number} size The current canvas size
 */
const pointInStroke = (test: Point, stroke: Stroke, size: number) => {
  const points = stroke?.points;
  if (!points) return false;

  const ratio = size / stroke.size;
  const scale = (x: number) => Math.floor(x * ratio);
  const scalePoint = (p: Point): Point => [scale(p[0]), scale(p[1])];
  const radius = Math.max(1, scale(stroke.brushRadius + 5));
  const radiusSquared = radius ** 2;
  const p0 = scalePoint(points[0]);

  if (points.length === 1) {
    return euclideanDistSqrd(test, p0) <= radiusSquared;
  } else {
    // check if test is within radius of a stroke point
    let topLeft: Point = [p0[0], p0[1]],
      bottomRight: Point = [p0[0], p0[1]];
    for (let i = 0; i < points.length; i++) {
      const sp = scalePoint(points[i]);
      if (euclideanDistSqrd(test, sp) <= radiusSquared) return true;
      // update stroke's bounding box
      topLeft = [Math.min(topLeft[0], sp[0]), Math.min(topLeft[1], sp[1])];
      bottomRight = [
        Math.max(bottomRight[0], sp[0]),
        Math.max(bottomRight[1], sp[1]),
      ];
    }
    // test IF point within bounding box of stroke
    return (
      topLeft[0] <= test[0] &&
      test[0] <= bottomRight[0] &&
      topLeft[1] <= test[1] &&
      test[1] <= bottomRight[1]
    );
  }
};

// FIXME: refactor this along with the func above
// TODO: calculate bounding box during handlePaintStart, and offset it along with the ref point
const getBoundingBox = (stroke: Stroke, size: number): [Point, Point] => {
  const points = stroke?.points;
  //if (!points) return false; // should never be true
  const ratio = size / stroke.size;
  const scale = (x: number) => Math.floor(x * ratio);
  const scalePoint = (p: Point): Point => [scale(p[0]), scale(p[1])];
  const radius = Math.max(1, scale(stroke.brushRadius));
  const p0 = scalePoint(points[0]);

  let topLeft: Point = [p0[0] - radius, p0[1] - radius],
    bottomRight: Point = [p0[0] + radius, p0[1] + radius];
  for (let i = 0; i < points.length; i++) {
    const sp = scalePoint(points[i]);
    // update stroke's bounding box
    topLeft = [
      Math.min(topLeft[0], sp[0] - radius),
      Math.min(topLeft[1], sp[1] - radius),
    ];
    bottomRight = [
      Math.max(bottomRight[0], sp[0] + radius),
      Math.max(bottomRight[1], sp[1] + radius),
    ];
  }
  return [topLeft, bottomRight];
};

const drawBoundingBox = (
  ctx: CanvasRenderingContext2D,
  [topLeft, bottomRight]: [Point, Point]
) => {
  ctx.strokeRect(
    topLeft[0],
    topLeft[1],
    bottomRight[0] - topLeft[0],
    bottomRight[1] - topLeft[1]
  );
};

/**
 * Compute the border point given an in-bounds point and an out-of-bounds pounts
 * @param {Point} point1 Point 1
 * @param {Point} point2 Point 2
 * @param {number} size The current canvas size
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
/*const calcBorderPoint = (point1: Point, point2: Point, size: number) => {
  if (!point1 || !point2) return null;
  // get bounding box for point pair
  const topLeft: Point = [
      Math.min(point1[0], point2[0]),
      Math.min(point1[1], point2[1]),
    ],
    bottomRight: Point = [
      Math.max(point1[0], point2[0]),
      Math.max(point1[1], point2[1]),
    ];

  // get vector diff
  const dp = ((p1: Point, p2: Point): Vector => [p2[0] - p1[0], p2[1] - p1[1]])(
    topLeft,
    bottomRight
  );

  let pointOnBorder: Point | null = null;

  if (topLeft[0] < 0 && 0 <= bottomRight[0]) {
    // crossing the left border
    const ratio = (0 - topLeft[0]) / dp[0]; // no x/0 error
    pointOnBorder = [0, topLeft[1] + ratio * dp[1]];
  } else if (topLeft[0] < size && size <= bottomRight[0]) {
    // crossing the right border
    const ratio = (size - topLeft[0]) / dp[0];
    pointOnBorder = [size, topLeft[1] + ratio * dp[1]];
  } else if (topLeft[1] < 0 && 0 <= bottomRight[1]) {
    // crossing the top border
    const ratio = (0 - topLeft[1]) / dp[1];
    pointOnBorder = [topLeft[0] + ratio * dp[0], 0];
  } else if (topLeft[1] < size && size <= bottomRight[1]) {
    // crossing the bottom border
    const ratio = (size - topLeft[1]) / dp[1];
    pointOnBorder = [topLeft[0] + ratio * dp[0], size];
  } else {
    console.warn("pointOnBorder unhandled", topLeft, bottomRight, dp);
  }
  //if (pointOnBorder) debug("borderpoint", topLeft, pointOnBorder, bottomRight);
  return pointOnBorder;
};*/

/**
 * Process a Stroke for export
 *
 * <s>For the moment this removes invalid points (i.e out-of-bound points), splits up Strokes into separate ones, as they enter and leave bounds, and integerises everything</s>
 *
 * @param {Point} test The point in question
 * @param {Stroke} stroke The stroke in question
 * @param {number} size The current canvas size
 */
export const processStroke = (stroke: Stroke): Stroke[] => {
  //const strokes: Stroke[] = [];
  if (stroke?.points) {
    // FIXME: find a way to properly clip points
    // the problem is probably with (de)serialising the strokes (confirmed, signed overflow)
    // using JSON to (de)serialise the Strokes as an interim fix
    /*// clip points to lie within bounds, results in a squished effect
    stroke.points = stroke.points.map((point) => [
      Math.min(stroke.size, Math.max(0, point[0])),
      Math.min(stroke.size, Math.max(0, point[1])),
    ]);*/
    /*// filter points not in bounds, but line segments between inbounds points and outbounds ones are lost
    stroke.points = stroke.points.filter(
      (point) =>
        0 <= point[0] &&
        point[0] <= stroke.size &&
        0 <= point[1] &&
        point[1] <= stroke.size
    );*/
    // BUG: need to take brushRadius into account when clipping
    /*
    const points = stroke.points;
    const pointInBounds = (point: Point) =>
      0 <= point[0] &&
      point[0] <= stroke.size &&
      0 <= point[1] &&
      point[1] <= stroke.size;

    let inBounds = true;
    let currentStroke: Stroke = { ...stroke, points: [] };

    for (let i = 0; i < points.length; i++) {
      if (pointInBounds(points[i])) {
        if (!inBounds) {
          // we've jumped back into bounds, add a point at the border
          const pointOnBorder = calcBorderPoint(
            points[i - 1],
            points[i],
            stroke.size
          );
          if (pointOnBorder) currentStroke.points.push(pointOnBorder);
          inBounds = true;
        }
        currentStroke.points.push(points[i]);
      } else if (inBounds) {
        inBounds = false;
        // we've jumped out of bounds, add a point at the border
        const pointOnBorder = calcBorderPoint(
          points[i - 1],
          points[i],
          stroke.size
        );
        if (pointOnBorder) currentStroke.points.push(pointOnBorder);
        // push currentStroke to stack and make a new one
        if (currentStroke.points.length) strokes.push(currentStroke);
        debug("new stroke", currentStroke);
        currentStroke = { ...stroke, points: [] };
        inBounds = false;
      } else continue; // ignore oob points
    }

    if (currentStroke.points.length) strokes.push(currentStroke);
    */
  }
  // integerise coords
  return [stroke].map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => [
      Math.floor(point[0]),
      Math.floor(point[1]),
    ]),
  }));
};

// TODO: sort strokes by a zIndex prop, for layering
/**
 * Component for a canvas to draw and show drawings on
 *
 * @component
 */
const Canvas = React.memo((props: any) => {
  const getProp = (prop: string) =>
    props[prop] ?? defaultProps[prop] ?? undefined;

  const currentStroke = useRef({} as Stroke);

  const displayedHistory: Stroke[] = getProp("displayedHistory"); // previously forcedHistory

  const size = getProp("size");
  const brushColour = getProp("brushColour");
  const brushRadius = getProp("brushRadius");
  const eraseMode = getProp("eraseMode");
  const isLocked = getProp("locked");
  const animated = getProp("animated");
  const dragMode = getProp("dragMode");
  const bgColour = getProp("bgColour");
  const boundingBoxDash = getProp("boundingBoxDash");

  const onStrokeDone = getProp("onStrokeDone");
  //const onDrag = getProp("onDrag");
  const onDragDone = getProp("onDragDone");
  const onAnimDone = getProp("onAnimDone");

  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas")),
    overlayRef = useRef<HTMLCanvasElement>(document.createElement("canvas")),
    drawMode = useRef(false), // TODO: rename drawMode to pointerDown or smth
    anim = useRef({
      // animation 'state'
      rafRef: 0,
      strokeIdx: 0,
      pointIdx: 0,
      lastCalled: 0,
      currentDelay: 0,
      initialDelay: 0,
    }),
    selectedStrokes = useRef({
      strokes: [] as StrokeIndexes,
      point: [0, 0] as Point,
      boundingBoxes: [] as [Point, Point][],
    }),
    draggedHistory = useRef([] as Stroke[]);

  const handlePaintStart = useCallback(
    (x: number, y: number) => {
      //console.log("handlePaintStart");
      const canvasXY = convertCoords(canvasRef, x, y);
      if (!drawMode.current) {
        drawMode.current = true;

        if (dragMode) {
          // store a copy of displayedHistory
          draggedHistory.current = JSON.parse(JSON.stringify(displayedHistory));
          // keep track of strokes under cursor position
          selectedStrokes.current = {
            ...selectedStrokes.current,
            strokes: draggedHistory.current.reduceRight(
              (acc, stroke, idx) =>
                !acc.length && // only drag the latest stroke for now
                pointInStroke(canvasXY, stroke, size)
                  ? acc.concat(idx)
                  : acc,
              [] as StrokeIndexes
            ),
            point: canvasXY,
          };
          // compute, draw and store bounding boxes
          const ctx = overlayRef.current?.getContext("2d", { alpha: true });
          if (ctx) {
            ctx.clearRect(0, 0, size, size);
            ctx.setLineDash(boundingBoxDash);
          }
          selectedStrokes.current.boundingBoxes = selectedStrokes.current.strokes.map(
            ctx
              ? (i) => {
                  const bb = getBoundingBox(draggedHistory.current[i], size);
                  drawBoundingBox(ctx, bb);
                  return bb;
                }
              : (i) => getBoundingBox(draggedHistory.current[i], size)
          );
          //if (selectedStrokes.current?.strokes) onDrag();
        } else {
          currentStroke.current = {
            // start tracking stroke
            colour: eraseMode ? "#ffffff" : brushColour,
            brushRadius: brushRadius,
            points: [canvasXY],
            size,
          };

          const ctx = canvasRef.current?.getContext("2d", { alpha: false });
          if (ctx) drawOnCanvas(ctx, currentStroke.current, size);
        }
      }
    },
    [
      boundingBoxDash,
      brushColour,
      brushRadius,
      displayedHistory,
      dragMode,
      eraseMode,
      size,
    ]
  );

  const handlePaint = useCallback(
    (x: number, y: number, drawOverlay = true) => {
      //console.log("handlePaint");
      const canvasXY = convertCoords(canvasRef, x, y);
      if (drawMode.current) {
        if (dragMode) {
          if (
            !selectedStrokes.current?.point ||
            !selectedStrokes.current?.strokes
          )
            return;
          // calculate displacement
          const dp = ((p1: Point, p2: Point): Vector => [
            p2[0] - p1[0],
            p2[1] - p1[1],
          ])(selectedStrokes.current.point, canvasXY);

          const ctx = canvasRef.current?.getContext("2d", { alpha: false });

          // loop through each selected stroke
          for (const i in selectedStrokes.current.strokes) {
            const strokeIdx = selectedStrokes.current.strokes[i];
            //reference to the stroke to be moved
            const selectedStroke = draggedHistory.current[strokeIdx];
            // the displacement vector ratio is inverse in this case
            const ratio = selectedStroke.size / size;
            const scale = (x: number) => (ratio === 1 ? x : x * ratio);
            // move each point
            selectedStroke.points = selectedStroke.points.map((p) => [
              p[0] + scale(dp[0]),
              p[1] + scale(dp[1]),
            ]);
            //update bounding box
            const bb = selectedStrokes.current.boundingBoxes[i];
            if (bb) {
              bb[0] = [bb[0][0] + dp[0], bb[0][1] + dp[1]];
              bb[1] = [bb[1][0] + dp[0], bb[1][1] + dp[1]];
            }
            // update reference point
            selectedStrokes.current.point = canvasXY;
            // show aftermath
            // draw strokes
            if (ctx) {
              ctx.fillStyle = bgColour;
              ctx.fillRect(0, 0, size, size);
              draggedHistory.current.forEach((stroke: Stroke) =>
                drawOnCanvas(ctx, stroke, size, false)
              );
            }
          }
          // draw bounding boxes
          const ctx2 = overlayRef.current?.getContext("2d", { alpha: true });
          if (ctx2) {
            ctx2.clearRect(0, 0, size, size);
            ctx2.setLineDash(boundingBoxDash);
            selectedStrokes.current.boundingBoxes.forEach((bb) =>
              drawBoundingBox(ctx2, bb)
            );
          }
        } else {
          const prevPoint =
            currentStroke.current.points[
              currentStroke.current.points.length - 1
            ];
          // ignore points that are sufficiently close, to save space
          // TODO: track all points here, write a wasm module to remove them before exporting the pic
          if (
            (prevPoint[0] - canvasXY[0]) ** 2 +
              (prevPoint[1] - canvasXY[1]) ** 2 >=
            currentStroke.current.brushRadius ** 1
          ) {
            currentStroke.current = {
              // append canvasXY to current stroke
              ...currentStroke.current,
              points: [...currentStroke.current.points, canvasXY],
            };
            const ctx = canvasRef.current?.getContext("2d", { alpha: false });
            if (ctx) drawOnCanvas(ctx, currentStroke.current, size);
          }
        }
      }

      if (drawOverlay && !dragMode) {
        // draw cursor indicator on overlay
        const ctx = overlayRef.current?.getContext("2d", { alpha: true });
        if (ctx) {
          ctx.clearRect(0, 0, size, size);
          ctx.beginPath();
          ctx.strokeStyle = "#000";
          ctx.arc(canvasXY[0], canvasXY[1], brushRadius, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    },
    [dragMode, size, bgColour, boundingBoxDash, brushRadius]
  );

  const handlePaintEnd = useCallback(
    (e: React.UIEvent, clearOverlay = false) => {
      e.preventDefault();
      //console.log("handlePaintEnd");
      if (drawMode.current) {
        drawMode.current = false;
        if (!dragMode) {
          onStrokeDone(currentStroke.current); // inform parent of new stroke
        } else {
          if (selectedStrokes.current.strokes) {
            if (onDragDone) {
              // signal drag op completion
              onDragDone(
                selectedStrokes.current.strokes,
                draggedHistory.current
              );
              // clear selectedStrokes
              selectedStrokes.current.strokes = [];
            } else {
              // no onDragDone handler, clear changes and revert back to displayedHistory
              const ctx = canvasRef.current?.getContext("2d", { alpha: false });
              if (ctx) {
                ctx.fillStyle = bgColour;
                ctx.fillRect(0, 0, size, size);
                displayedHistory.forEach((stroke: Stroke) =>
                  drawOnCanvas(ctx, stroke, size, false)
                );
              }
            }
          }
        }
      }

      if (clearOverlay || dragMode) {
        const ctx = overlayRef.current?.getContext("2d", { alpha: true }); // has to be transparent
        if (ctx) ctx.clearRect(0, 0, size, size); // clear overlay
      }
    },
    [displayedHistory, dragMode, onDragDone, onStrokeDone, size, bgColour]
  );

  // TODO: refactor the painting logic out of this
  const handleFrame = useCallback(
    (time: number) => {
      if (!anim.current.lastCalled) {
        anim.current.lastCalled = time;
        anim.current.currentDelay = anim.current.initialDelay;
      } else if (time - anim.current.lastCalled >= anim.current.currentDelay) {
        anim.current.lastCalled = time;

        const stroke = displayedHistory[anim.current.strokeIdx];
        if (!stroke) return;

        const point =
          displayedHistory[anim.current.strokeIdx].points[
            anim.current.pointIdx
          ];
        if (!point) return;

        const ctx = canvasRef.current?.getContext("2d", { alpha: false });

        if (ctx) {
          const ratio = size / stroke.size;
          const scale = (x: number) => Math.floor(x * ratio);
          const scalePoint = (p: Point): Point => [scale(p[0]), scale(p[1])];
          const radius = Math.max(1, scale(stroke.brushRadius));
          const currentPoint = scalePoint(point);

          if (stroke.points.length === 1 || anim.current.pointIdx === 0) {
            ctx.beginPath();
            ctx.fillStyle = stroke.colour;
            ctx.arc(currentPoint[0], currentPoint[1], radius, 0, 2 * Math.PI);
            ctx.fill();
          } else {
            ctx.lineWidth = radius * 2;
            ctx.lineCap = "round";
            ctx.strokeStyle = stroke.colour;
            ctx.beginPath();
            const prevPoint = scalePoint(
              displayedHistory[anim.current.strokeIdx].points[
                anim.current.pointIdx - 1
              ]
            ); // should never be nullish
            ctx.moveTo(prevPoint[0], prevPoint[1]);
            ctx.lineTo(currentPoint[0], currentPoint[1]);
            ctx.stroke();
          }
        }

        anim.current.pointIdx += 1;

        if (anim.current.pointIdx >= stroke.points.length) {
          // move to next stroke
          anim.current.pointIdx = 0;
          anim.current.strokeIdx += 1;
          anim.current.currentDelay = getRandInRange(40, 120);
        } else anim.current.currentDelay = getRandInRange(0, 32);

        if (anim.current.strokeIdx >= displayedHistory.length) {
          // no more strokes
          anim.current.rafRef = 0;
          onAnimDone();
          return;
        }
      }
      anim.current.rafRef = window.requestAnimationFrame(handleFrame);
    },
    [displayedHistory, size, onAnimDone]
  );

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d", { alpha: false });
    if (ctx) {
      ctx.fillStyle = bgColour;
      ctx.fillRect(0, 0, size, size);
      if (
        anim.current.rafRef &&
        anim.current.strokeIdx < displayedHistory.length
      ) {
        // we're rendering during an animation
        // assume displayedHistory hasn't changed

        // pause animation
        window.cancelAnimationFrame(anim.current.rafRef);

        // draw already-animated strokes
        for (let i = 0; i < anim.current.strokeIdx; i++)
          drawOnCanvas(ctx, displayedHistory[i], size, false);

        // draw already-animated points of the currently-animated stroke
        const stroke = displayedHistory[anim.current.strokeIdx];
        const partialStroke = {
          ...stroke,
          points: stroke.points.slice(0, anim.current.pointIdx),
        };
        drawOnCanvas(ctx, partialStroke, size, false);

        // resume animation
        anim.current.rafRef = window.requestAnimationFrame(handleFrame);
      }

      if (!animated) {
        // draw displayedHistory as per normal
        displayedHistory.forEach((s) => drawOnCanvas(ctx, s, size, false));
      } else {
        // start animation
        if (!anim.current.rafRef)
          // don't reset indexes if currently animating, assume displayedHistory hasn't changed
          anim.current = {
            rafRef: window.requestAnimationFrame(handleFrame),
            strokeIdx: 0,
            pointIdx: 0,
            lastCalled: 0,
            currentDelay: 0,
            initialDelay: 0,
          };

        return () => window.cancelAnimationFrame(anim.current.rafRef);
      }
    }
  }, [displayedHistory, size, animated, handleFrame, bgColour]);

  return (
    <Paper
      elevation={6}
      className="canvas-paper"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        cursor: animated ? "wait" : dragMode ? "grab" : "inherit",
      }}
    >
      <canvas ref={canvasRef} height={size} width={size} className="canvas" />
      <canvas
        ref={overlayRef}
        height={size}
        width={size}
        className="canvas-overlay"
        style={{
          touchAction: animated || !isLocked ? "none" : "auto", // enable touch scrolling if canvas is not animating or is locked
        }}
        {...(animated || isLocked // do not register event listeners if isLocked or animating
          ? {}
          : {
              onMouseDown: (e) => handlePaintStart(e.clientX, e.clientY),
              onMouseMove: (e) => handlePaint(e.clientX, e.clientY),
              onMouseUp: handlePaintEnd,
              onMouseLeave: (e) => handlePaintEnd(e, true),
              onTouchStart: (e) =>
                handlePaintStart(
                  e.changedTouches[0].clientX,
                  e.changedTouches[0].clientY
                ),
              onTouchMove: (e) =>
                handlePaint(
                  e.changedTouches[0].clientX,
                  e.changedTouches[0].clientY,
                  false
                ),
              onTouchEnd: handlePaintEnd,
              onTouchCancel: handlePaintEnd,
            })}
        onContextMenu={(e) => e.preventDefault()}
      />
    </Paper>
  );
});

export default Canvas;
