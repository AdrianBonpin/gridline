import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 8; // marker size

/** Custom edge that draws IE crow's foot notation at endpoints. */
export function CrowsFootEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  style,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  // Direction vector
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  const G = 6; // gap from node edge

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {markerStart && (
        <g transform={`translate(${sourceX + ux * G},${sourceY + uy * G}) rotate(${Math.atan2(uy, ux) * 180 / Math.PI})`}>
          <Symbol type={markerStart} />
        </g>
      )}
      {markerEnd && (
        <g transform={`translate(${targetX - ux * G},${targetY - uy * G}) rotate(${Math.atan2(-uy, -ux) * 180 / Math.PI})`}>
          <Symbol type={markerEnd} />
        </g>
      )}
    </g>
  );
}

/** Draw crow's foot symbol at origin (0,0), pointing right (+x). */
function Symbol({ type }: { type: string }) {
  switch (type) {
    case "one":
      // Vertical line |
      return <line x1={0} y1={-S} x2={0} y2={S} stroke={C} strokeWidth={1.5} />;
    case "many":
      // Crow's foot: three lines fanning left
      return (
        <g>
          <line x1={0} y1={0} x2={-S} y2={-S * 0.7} stroke={C} strokeWidth={1.5} />
          <line x1={0} y1={0} x2={-S} y2={0} stroke={C} strokeWidth={1.5} />
          <line x1={0} y1={0} x2={-S} y2={S * 0.7} stroke={C} strokeWidth={1.5} />
        </g>
      );
    default:
      return null;
  }
}