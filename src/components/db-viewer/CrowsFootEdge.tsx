import { type EdgeProps, getSmoothStepPath } from "@xyflow/react";

const MARKER_COLOR = "#3b82f6";

function OneMarker({ cx, cy, angle }: { cx: number; cy: number; angle: number }) {
  const size = 6;
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) * size;
  const dy = Math.sin(rad) * size;
  return (
    <line
      x1={cx - dy}
      y1={cy + dx}
      x2={cx + dy}
      y2={cy - dx}
      stroke={MARKER_COLOR}
      strokeWidth={1.5}
    />
  );
}

function ManyMarker({ cx, cy, angle }: { cx: number; cy: number; angle: number }) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Perpendicular offset from the line direction
  const lines = [
    { ox: -5, oy: -3, ex: 0, ey: -5 },
    { ox: 0, oy: 0, ex: 0, ey: -6 },
    { ox: 5, oy: 3, ex: 0, ey: -5 },
  ];
  return (
    <g>
      {lines.map((l, i) => {
        const sx = cx + l.ox * cos - l.oy * sin;
        const sy = cy + l.ox * sin + l.oy * cos;
        const tx = cx + l.ex * cos - l.ey * sin;
        const ty = cy + l.ex * sin + l.ey * cos;
        return (
          <line
            key={i}
            x1={sx}
            y1={sy}
            x2={tx}
            y2={ty}
            stroke={MARKER_COLOR}
            strokeWidth={1.5}
          />
        );
      })}
    </g>
  );
}

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
  label,
  style,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  // Calculate angles at endpoints for marker orientation
  const startAngle =
    (Math.atan2(targetY - sourceY, targetX - sourceX) * 180) / Math.PI;
  const endAngle = startAngle + 180;

  return (
    <g>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={MARKER_COLOR}
        strokeWidth={1.5}
        style={style}
      />
      {/* Start marker */}
      {markerStart && (
        <g transform={`translate(${sourceX}, ${sourceY})`}>
          {markerStart === "many" ? (
            <ManyMarker cx={0} cy={0} angle={startAngle} />
          ) : (
            <OneMarker cx={0} cy={0} angle={startAngle} />
          )}
        </g>
      )}
      {/* End marker */}
      {markerEnd && (
        <g transform={`translate(${targetX}, ${targetY})`}>
          {markerEnd === "many" ? (
            <ManyMarker cx={0} cy={0} angle={endAngle} />
          ) : (
            <OneMarker cx={0} cy={0} angle={endAngle} />
          )}
        </g>
      )}
    </g>
  );
}