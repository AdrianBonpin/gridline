import { type EdgeProps, getSmoothStepPath } from "@xyflow/react";

const STROKE = "#3b82f6";
const SW = 1.5;
const GAP = 8; // gap between marker and node edge
const SIZE = 8; // marker size

/**
 * Custom edge that draws IE crow's foot notation directly:
 *   "one"  = short vertical line  | 
 *   "many" = crow's foot (3 lines) ┤├
 *   "zero" = small circle ○
 */
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

  // Direction vector from source to target
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len; // unit vector towards target
  const uy = dy / len;

  return (
    <g>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={STROKE}
        strokeWidth={SW}
        style={style}
      />
      {/* Source marker (at the FK/child table side) */}
      {markerStart && (
        <g
          transform={`translate(${sourceX + ux * GAP}, ${sourceY + uy * GAP}) rotate(${Math.atan2(uy, ux) * (180 / Math.PI)})`}
        >
          <Marker type={markerStart} />
        </g>
      )}
      {/* Target marker (at the PK/parent table side) */}
      {markerEnd && (
        <g
          transform={`translate(${targetX - ux * GAP}, ${targetY - uy * GAP}) rotate(${Math.atan2(-uy, -ux) * (180 / Math.PI)})`}
        >
          <Marker type={markerEnd} />
        </g>
      )}
      {/* Edge label */}
      {label && (
        <text
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2 - 8}
          textAnchor="middle"
          fill="#9ca3af"
          fontSize={9}
          fontFamily="monospace"
        >
          {typeof label === "string" ? label : ""}
        </text>
      )}
    </g>
  );
}

/** Draws the IE crow's foot symbol at origin (0,0), pointing right (+x). */
function Marker({ type }: { type: string }) {
  if (type === "many") {
    return (
      <g>
        <line x1={0} y1={0} x2={-SIZE} y2={-SIZE / 2} stroke={STROKE} strokeWidth={SW} />
        <line x1={0} y1={0} x2={-SIZE} y2={0} stroke={STROKE} strokeWidth={SW} />
        <line x1={0} y1={0} x2={-SIZE} y2={SIZE / 2} stroke={STROKE} strokeWidth={SW} />
      </g>
    );
  }
  if (type === "one") {
    return (
      <line x1={0} y1={-SIZE / 2} x2={0} y2={SIZE / 2} stroke={STROKE} strokeWidth={SW} />
    );
  }
  if (type === "zero-one" || type === "zero-many") {
    return (
      <g>
        <circle cx={-SIZE / 2 - 2} cy={0} r={SIZE / 3} fill="none" stroke={STROKE} strokeWidth={SW} />
        {type === "zero-many" ? (
          <>
            <line x1={0} y1={0} x2={-SIZE} y2={-SIZE / 2} stroke={STROKE} strokeWidth={SW} />
            <line x1={0} y1={0} x2={-SIZE} y2={0} stroke={STROKE} strokeWidth={SW} />
            <line x1={0} y1={0} x2={-SIZE} y2={SIZE / 2} stroke={STROKE} strokeWidth={SW} />
          </>
        ) : (
          <line x1={0} y1={-SIZE / 2} x2={0} y2={SIZE / 2} stroke={STROKE} strokeWidth={SW} />
        )}
      </g>
    );
  }
  return null;
}