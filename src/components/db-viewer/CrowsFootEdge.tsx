import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

const C = "#3b82f6";
const S = 10;
const G = 8;

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
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 8,
    });

    const sm = (data as any)?.startMarker as string;
    const em = (data as any)?.endMarker as string;

    // Which way does the edge go? (source → target)
    const toRight = targetX >= sourceX;
    // Source: offset AWAY from source card (into the gap), lines point BACK toward source
    // Target: offset AWAY from target card (into the gap), lines point BACK toward target
    const sOff = toRight ? 1 : -1; // source offset direction
    const tOff = toRight ? -1 : 1; // target offset direction
    const sDir = toRight ? -1 : 1; // source lines point toward source table
    const tDir = toRight ? 1 : -1; // target lines point toward target table

    return (
        <g>
            <BaseEdge
                id={id}
                path={edgePath}
                style={{ stroke: C, strokeWidth: 1.5, ...style }}
            />
            {sm && (
                <Mark
                    type={sm}
                    cx={sourceX + sOff * G}
                    cy={sourceY}
                    dir={sDir}
                />
            )}
            {em && (
                <Mark
                    type={em}
                    cx={targetX + tOff * G}
                    cy={targetY}
                    dir={tDir}
                />
            )}
        </g>
    );
}

function Mark({
    type,
    cx,
    cy,
    dir,
}: {
    type: string;
    cx: number;
    cy: number;
    dir: number;
}) {
    if (type === "one") {
        return (
            <line
                x1={cx}
                y1={cy - S}
                x2={cx}
                y2={cy + S}
                stroke={C}
                strokeWidth={2}
                strokeLinecap="round"
            />
        );
    }

    if (type === "many") {
        const sp = 4;
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
