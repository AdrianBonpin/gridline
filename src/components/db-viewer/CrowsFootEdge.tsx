import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 9;

export function CrowsFootEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) {
  const [edgePath, , , offsetSx, offsetSy, offsetTx, offsetTy] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  const sm = (data as any)?.startMarker as string;
  const em = (data as any)?.endMarker as string;

  // Tangent direction at each endpoint from the path geometry
  const sa = Math.atan2(offsetSy - sourceY, offsetSx - sourceX);
  const ta = Math.atan2(targetY - offsetTy, targetX - offsetTx);
  const d = (r: number) => r * 180 / Math.PI;

  return (
    <g>
      {/* Shorten the edge slightly so symbols sit flush against the card */}
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {/* Source marker at exact source coordinates */}
      <g transform={`translate(${sourceX},${sourceY}) rotate(${d(sa)})`}>
        <Sym type={sm} />
      </g>
      {/* Target marker at exact target coordinates */}
      <g transform={`translate(${targetX},${targetY}) rotate(${d(ta)})`}>
        <Sym type={em} />
      </g>
    </g>
  );
}

function Sym({ type }: { type: string }) {
  if (type === "one") {
    // Vertical line perpendicular to edge direction
    return (
      <line
        x1={0} y1={-S}
        x2={0} y2={S}
        stroke={C} strokeWidth={2}
        strokeLinecap="round"
      />
    );
  }
  if (type === "many") {
    // Crow's foot: three lines fanning away from the edge
    return (
      <g>
        <line x1={0} y1={0} x2={-S} y2={-S * 0.6} stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={0} y1={0} x2={-S} y2={0} stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={0} y1={0} x2={-S} y2={S * 0.6} stroke={C} strokeWidth={2} strokeLinecap="round" />
      </g>
    );
  }
  return null;
}