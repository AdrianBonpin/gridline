import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 8;

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

  // Direction unit vector (source → target)
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len; // unit toward target
  const uy = dy / len;
  // Perpendicular unit vector (rotate 90° CCW)
  const px = -uy;
  const py = ux;

  return (
    <g>
      <BaseEdge id={id} path={edgePath} style={{ stroke: C, strokeWidth: 1.5, ...style }} />
      {/* Source marker */}
      {sm && (
        <Mark 
          type={sm} 
          cx={sourceX} cy={sourceY} 
          ex={ux} ey={uy}   // edge direction (outward from source)
          px={px} py={py}   // perpendicular
        />
      )}
      {/* Target marker */}
      {em && (
        <Mark 
          type={em} 
          cx={targetX} cy={targetY} 
          ex={-ux} ey={-uy}  // edge direction reversed (outward from target)
          px={px} py={py}
        />
      )}
    </g>
  );
}

/**
 * Draws crow's foot symbol at (cx, cy).
 * - (ex, ey) = unit vector pointing OUTWARD from the node along the edge
 * - (px, py) = unit vector perpendicular to the edge
 */
function Mark({ type, cx, cy, ex, ey, px, py }: {
  type: string; cx: number; cy: number; ex: number; ey: number; px: number; py: number;
}) {
  const G = 6; // gap from handle
  const ox = cx + ex * G; // offset outward from handle
  const oy = cy + ey * G;

  if (type === "one") {
    // Short line perpendicular to edge, at the offset point
    return (
      <line
        x1={ox + px * S} y1={oy + py * S}
        x2={ox - px * S} y2={oy - py * S}
        stroke={C} strokeWidth={2} strokeLinecap="round"
      />
    );
  }

  if (type === "many") {
    // Three lines fanning INWARD (back toward the node)
    const a0 = Math.atan2(ey, ex); // base angle pointing outward
    const spread = 0.35; // radians (~20°)
    const len = S + 2;
    return (
      <g>
        {[-spread, 0, spread].map((off, i) => {
          const ang = a0 + off;
          const lx = ox + Math.cos(ang) * len;
          const ly = oy + Math.sin(ang) * len;
          return (
            <line key={i}
              x1={ox} y1={oy}
              x2={lx} y2={ly}
              stroke={C} strokeWidth={2} strokeLinecap="round"
            />
          );
        })}
      </g>
    );
  }

  return null;
}