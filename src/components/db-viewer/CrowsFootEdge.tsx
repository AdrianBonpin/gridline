import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 8;

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

  const startMarker = (data as any)?.startMarker as string | undefined;
  const endMarker = (data as any)?.endMarker as string | undefined;

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const G = 6;
  const r2d = 180 / Math.PI;

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {/* Debug: always show circles at endpoints to verify component renders */}
      <circle cx={sourceX} cy={sourceY} r={4} fill="#f00" />
      <circle cx={targetX} cy={targetY} r={4} fill="#0f0" />
      {startMarker && (
        <g transform={`translate(${sourceX + ux * G},${sourceY + uy * G}) rotate(${Math.atan2(uy, ux) * r2d})`}>
          <Sym type={startMarker} />
        </g>
      )}
      {endMarker && (
        <g transform={`translate(${targetX - ux * G},${targetY - uy * G}) rotate(${Math.atan2(-uy, -ux) * r2d})`}>
          <Sym type={endMarker} />
        </g>
      )}
    </g>
  );
}

function Sym({ type }: { type: string }) {
  if (type === "one") return <line x1={0} y1={-S} x2={0} y2={S} stroke={C} strokeWidth={1.5} />;
  if (type === "many") return (
    <g>
      <line x1={0} y1={0} x2={-S} y2={-S * 0.7} stroke={C} strokeWidth={1.5} />
      <line x1={0} y1={0} x2={-S} y2={0} stroke={C} strokeWidth={1.5} />
      <line x1={0} y1={0} x2={-S} y2={S * 0.7} stroke={C} strokeWidth={1.5} />
    </g>
  );
  return null;
}