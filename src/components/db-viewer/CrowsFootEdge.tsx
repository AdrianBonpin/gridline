import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 10;
const G = 6;

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

  // Which way does the edge go? (source → target)
  const toRight = targetX >= sourceX;
  // At source: edge exits, symbol points back toward source table
  const sDir = toRight ? -1 : 1; // source marker points left if edge goes right
  // At target: edge enters, symbol points back toward target table
  const tDir = toRight ? 1 : -1;

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {sm && <Mark type={sm} cx={sourceX} cy={sourceY} dir={sDir} />}
      {em && <Mark type={em} cx={targetX} cy={targetY} dir={tDir} />}
    </g>
  );
}

function Mark({ type, cx, cy, dir }: { type: string; cx: number; cy: number; dir: number }) {
  const ox = cx + dir * G; // offset away from handle

  if (type === "one") {
    // Simple vertical line
    return <line x1={ox} y1={cy - S} x2={ox} y2={cy + S} stroke={C} strokeWidth={2} strokeLinecap="round" />;
  }

  if (type === "many") {
    // Three horizontal lines pointing in direction `dir`
    const sp = 5;
    return (
      <g>
        <line x1={ox} y1={cy - sp} x2={ox + dir * S} y2={cy - sp} stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={ox} y1={cy}      x2={ox + dir * S} y2={cy}      stroke={C} strokeWidth={2} strokeLinecap="round" />
        <line x1={ox} y1={cy + sp} x2={ox + dir * S} y2={cy + sp} stroke={C} strokeWidth={2} strokeLinecap="round" />
      </g>
    );
  }

  return null;
}