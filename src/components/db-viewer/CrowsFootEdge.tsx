import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 10;

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
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  // data.startMarker / data.endMarker: "one" | "many" | ""
  const sm = (data as any)?.startMarker as string;
  const em = (data as any)?.endMarker as string;

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const G = 8;
  const deg = (rad: number) => rad * 180 / Math.PI;

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {/* Source marker */}
      <g transform={`translate(${sourceX + ux * G},${sourceY + uy * G}) rotate(${deg(Math.atan2(uy, ux))})`}>
        <Sym type={sm} />
      </g>
      {/* Target marker */}
      <g transform={`translate(${targetX - ux * G},${targetY - uy * G}) rotate(${deg(Math.atan2(-uy, -ux))})`}>
        <Sym type={em} />
      </g>
    </g>
  );
}

function Sym({ type }: { type: string }) {
  if (type === "one") {
    return <line x1={0} y1={-S} x2={0} y2={S} stroke={C} strokeWidth={2} />;
  }
  if (type === "many") {
    return (
      <g>
        <line x1={0} y1={0} x2={-S} y2={-S * 0.7} stroke={C} strokeWidth={2} />
        <line x1={0} y1={0} x2={-S} y2={0} stroke={C} strokeWidth={2} />
        <line x1={0} y1={0} x2={-S} y2={S * 0.7} stroke={C} strokeWidth={2} />
      </g>
    );
  }
  return null;
}