import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 10;
const G = 6; // gap from handle

export function CrowsFootEdge({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  const sm = (data as any)?.startMarker as string;
  const em = (data as any)?.endMarker as string;

  // Direction: which way does edge go?
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {sm && <Mark type={sm} cx={sourceX} cy={sourceY} dirX={dx} dirY={dy} />}
      {em && <Mark type={em} cx={targetX} cy={targetY} dirX={-dx} dirY={-dy} />}
    </g>
  );
}

/**
 * Draws fixed-orientation marker at (cx, cy).
 * (dirX, dirY) indicates which way the edge goes FROM this point.
 * Symbol points TOWARD the node (opposite to dir).
 */
function Mark({ type, cx, cy, dirX, dirY }: {
  type: string; cx: number; cy: number; dirX: number; dirY: number;
}) {
  // Normalize
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;

  // Offset from handle
  const ox = cx + ux * G;
  const oy = cy + uy * G;

  // Point TOWARD the node (opposite to dir)
  const nx = -ux;
  const ny = -uy;

  if (type === "one") {
    // Simple vertical line | 
    return (
      <line
        x1={ox} y1={oy - S}
        x2={ox} y2={oy + S}
        stroke={C} strokeWidth={2} strokeLinecap="round"
      />
    );
  }

  if (type === "many") {
    // Crow's foot: 3 lines fanning TOWARD the node
    // Use mostly horizontal spread, mixed with vertical based on edge direction
    const spread = 5;
    return (
      <g>
        <line x1={ox} y1={oy - spread} x2={ox + nx * S} y2={oy - spread + ny * S} stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={ox} y1={oy} x2={ox + nx * S} y2={oy + ny * S} stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={ox} y1={oy + spread} x2={ox + nx * S} y2={oy + spread + ny * S} stroke={C} strokeWidth={2} strokeLinecap="round" />
      </g>
    );
  }

  return null;
}