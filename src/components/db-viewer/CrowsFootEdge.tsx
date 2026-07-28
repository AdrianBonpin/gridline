import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 10;
const G = 4;

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

  const sm = (data as any)?.startMarker as string;
  const em = (data as any)?.endMarker as string;
  // Use ORIGINAL layout direction stored in edge data — never re-compute.
  // Prevents symbols from flipping when user drags tables around.
  const origRight = (data as any)?.origRight as boolean | undefined;
  const right = origRight !== undefined ? origRight : targetX < sourceX ? false : true;
  const sOff = right ? 1 : -1;
  const tOff = right ? -1 : 1;
  const sDir = right ? 1 : -1;
  const tDir = right ? -1 : 1;

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {sm && <Mark type={sm} cx={sourceX + sOff * G} cy={sourceY} dir={sDir} />}
      {em && <Mark type={em} cx={targetX + tOff * G} cy={targetY} dir={tDir} />}
    </g>
  );
}

function Mark({ type, cx, cy, dir }: { type: string; cx: number; cy: number; dir: number }) {
  if (type === "one") {
    return <line x1={cx} y1={cy - S} x2={cx} y2={cy + S} stroke={C} strokeWidth={2} strokeLinecap="round" />;
  }
  if (type === "many") {
    const sp = 6;
    const tx = cx + dir * S;
    return (
      <g>
        <line x1={cx} y1={cy - sp} x2={tx} y2={cy} stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={cx} y1={cy}      x2={tx} y2={cy} stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={cx} y1={cy + sp} x2={tx} y2={cy} stroke={C} strokeWidth={2} strokeLinecap="round" />
      </g>
    );
  }
  return null;
}