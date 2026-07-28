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
  const [edgePath, labelX, labelY, offsetSx, offsetSy, offsetTx, offsetTy] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  const sm = (data as any)?.startMarker as string;
  const em = (data as any)?.endMarker as string;

  // Tangent at source: from source point to first offset point
  const sxDir = Math.atan2(offsetSy - sourceY, offsetSx - sourceX);
  // Tangent at target: from last offset point to target point
  const txDir = Math.atan2(targetY - offsetTy, targetX - offsetTx);

  const deg = (rad: number) => rad * 180 / Math.PI;
  const G = 6;

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      <g transform={`translate(${sourceX},${sourceY}) rotate(${deg(sxDir)})`}>
        <Sym type={sm} />
      </g>
      <g transform={`translate(${targetX},${targetY}) rotate(${deg(txDir)})`}>
        <Sym type={em} />
      </g>
    </g>
  );
}

function Sym({ type }: { type: string }) {
  if (type === "one") {
    return <line x1={0} y1={-S} x2={0} y2={S} stroke={C} strokeWidth={1.5} />;
  }
  if (type === "many") {
    return (
      <g>
        <line x1={0} y1={0} x2={-S} y2={-S * 0.7} stroke={C} strokeWidth={1.5} />
        <line x1={0} y1={0} x2={-S} y2={0} stroke={C} strokeWidth={1.5} />
        <line x1={0} y1={0} x2={-S} y2={S * 0.7} stroke={C} strokeWidth={1.5} />
      </g>
    );
  }
  return null;
}