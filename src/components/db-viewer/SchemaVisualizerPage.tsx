import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { RotateCcw, ChevronUp, ChevronDown } from "lucide-react";
import { SchemaVisualizerNode } from "./SchemaVisualizerNode";
import { LEGEND_ITEMS } from "./legendHelpers";
import { SelectDropdown } from "../ui/SelectDropdown";
import { getSchemaGraph } from "../../lib/commands";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { SchemaGraph, TableNode as TableNodeType } from "../../lib/types";

const nodeTypes = { tableNode: SchemaVisualizerNode };

const CARD_WIDTH = 240;
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;

function getNodeHeight(colCount: number): number {
  return HEADER_HEIGHT + colCount * ROW_HEIGHT + 4;
}

function layoutGraph(
  tables: TableNodeType[],
  relationships: { source_table: string; target_table: string; source_column: string; target_column: string; cardinality: string }[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });

  // Build a lookup: key = "sourceTable.sourceCol->targetTable.targetCol" → cardinality
  const cardinalityMap = new Map<string, string>();
  for (const rel of relationships) {
    cardinalityMap.set(
      `${rel.source_table}.${rel.source_column}->${rel.target_table}.${rel.target_column}`,
      rel.cardinality,
    );
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const table of tables) {
    const height = getNodeHeight(table.columns.length);
    g.setNode(table.name, { width: CARD_WIDTH, height });
    nodes.push({
      id: table.name,
      type: "tableNode",
      position: { x: 0, y: 0 },
      data: { table, isExternal: false },
      style: { width: CARD_WIDTH },
    });
  }

  for (const table of tables) {
    for (const col of table.columns) {
      if (col.fk_ref) {
        const [refSchema, refTable, refColumn] = col.fk_ref;
        if (tables.some((t) => t.name === refTable && t.schema === refSchema)) {
          const edgeKey = `${table.name}.${col.name}->${refTable}.${refColumn}`;
          const cardinality = cardinalityMap.get(edgeKey) ?? "1:N";
          const markers = getEdgeMarkers(cardinality);

          g.setEdge(table.name, refTable, {});
          edges.push({
            id: edgeKey,
            source: table.name,
            target: refTable,
            sourceHandle: `fk-${col.name}`,
            targetHandle: `pk-${refColumn}`,
            type: "smoothstep",
            label: cardinality,
            markerStart: markers.markerStart,
            markerEnd: markers.markerEnd,
            style: { stroke: "#3b82f6", strokeWidth: 1.5 },
            labelStyle: { fill: "#9ca3af", fontSize: 9 },
            labelBgStyle: { fill: "#1f2937", fillOpacity: 0.85 },
            labelBgPadding: [3, 1],
            labelBorderRadius: 0,
          });
        }
      }
    }
  }

  dagre.layout(g);

  for (const node of nodes) {
    const dagreNode = g.node(node.id);
    if (dagreNode) {
      node.position = {
        x: dagreNode.x - CARD_WIDTH / 2,
        y: dagreNode.y - (dagreNode as any).height / 2,
      };
    }
  }

  return { nodes, edges };
}

function getEdgeMarkers(cardinality: string): { markerStart: string; markerEnd: string } {
  switch (cardinality) {
    case "1:1":
      return { markerStart: "url(#rf-cf-one)", markerEnd: "url(#rf-cf-one)" };
    case "1:N":
      return { markerStart: "url(#rf-cf-many)", markerEnd: "url(#rf-cf-one)" };
    case "N:M":
      return { markerStart: "url(#rf-cf-many)", markerEnd: "url(#rf-cf-many)" };
    default:
      return { markerStart: "", markerEnd: "" };
  }
}

export interface SchemaVisualizerPageProps {
  connectionId: string;
  onSchemaChange?: (schema: string) => void;
}

export function SchemaVisualizerPage({
  connectionId,
  onSchemaChange,
}: SchemaVisualizerPageProps) {
  const databases = useDbViewerStore((s) => s.databases);
  const schemas = useDbViewerStore((s) => s.schemas);
  const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
  const currentSchema = useDbViewerStore((s) => s.currentSchema);
  const setCurrentDatabase = useDbViewerStore((s) => s.setCurrentDatabase);
  const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tableCount, setTableCount] = useState(0);
  const [legendOpen, setLegendOpen] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Inject SVG marker defs into ReactFlow's internal SVG for crow's foot notation
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const svg = el.querySelector("svg");
    if (!svg) return;
    // Avoid duplicates
    if (svg.querySelector("#rf-cf-defs")) return;

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.id = "rf-cf-defs";
    defs.innerHTML = `
      <marker id="rf-cf-one" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <line x1="2" y1="0" x2="2" y2="12" stroke="#3b82f6" stroke-width="1.5" />
      </marker>
      <marker id="rf-cf-many" viewBox="0 0 14 12" refX="14" refY="6" markerWidth="10" markerHeight="8" orient="auto-start-reverse">
        <line x1="0" y1="0" x2="10" y2="3" stroke="#3b82f6" stroke-width="1.5" />
        <line x1="0" y1="12" x2="10" y2="9" stroke="#3b82f6" stroke-width="1.5" />
        <line x1="0" y1="6" x2="10" y2="6" stroke="#3b82f6" stroke-width="1.5" />
      </marker>
    `;
    svg.insertBefore(defs, svg.firstChild);
  }, [nodes.length > 0]); // re-run when nodes change (canvas rendered)

  const fetchGraph = useCallback(async () => {
    if (!currentSchema) return;
    setLoading(true);
    setError(null);
    try {
      const graph: SchemaGraph = await getSchemaGraph(connectionId, currentSchema);
      if (graph.tables.length === 0) {
        setNodes([]);
        setEdges([]);
        setTableCount(0);
      } else {
        const { nodes: layoutedNodes, edges: layoutedEdges } = layoutGraph(graph.tables, graph.relationships);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        if (graph.tables.length > 200) {
          const proceed = window.confirm(
            `This schema has ${graph.tables.length} tables. Rendering the full diagram may be slow. Continue?`,
          );
          if (!proceed) {
            setLoading(false);
            return;
          }
        }
        setTableCount(graph.tables.length);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [connectionId, currentSchema, setNodes, setEdges]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleResetLayout = useCallback(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleSchemaChange = useCallback(
    (schema: string) => {
      setCurrentSchema(schema);
      onSchemaChange?.(schema);
    },
    [setCurrentSchema, onSchemaChange],
  );

  const schemaOptions = useMemo(
    () => schemas.map((s) => ({ value: s, label: s })),
    [schemas],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border shrink-0 relative z-10">
        <div className="flex items-center gap-2">
          {databases.length > 1 && (
            <SelectDropdown
              value={currentDatabase ?? ""}
              onChange={setCurrentDatabase}
              options={databases.map((d) => ({ value: d, label: d }))}
              placeholder="Select database"
              variant="ghost"
            />
          )}
          {databases.length > 1 && schemas.length > 0 && (
            <span className="text-border">|</span>
          )}
          {schemas.length > 0 && (
            <SelectDropdown
              value={currentSchema ?? ""}
              options={schemaOptions}
              onChange={handleSchemaChange}
              placeholder="Select schema"
              variant="ghost"
            />
          )}
        </div>
        <div className="flex-1" />
        <span className="text-xs text-text-muted">
          {tableCount} {tableCount === 1 ? "table" : "tables"}
        </span>
        <button
          type="button"
          onClick={handleResetLayout}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-raised"
        >
          <RotateCcw size={12} />
          Reset Layout
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 relative" ref={canvasRef}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-canvas/80">
            <p className="text-text-muted text-sm">Loading schema...</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-canvas/80 gap-3">
            <p className="text-red-400 text-sm">Failed to load schema: {error}</p>
            <button
              type="button"
              onClick={fetchGraph}
              className="px-3 py-1 text-xs rounded-md bg-surface border border-border text-text-muted hover:text-text"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && tableCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-text-muted text-sm">
              No tables found in schema &quot;{currentSchema}&quot;
            </p>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          className="bg-canvas"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" gap={20} color="var(--color-border)" />
          <MiniMap
            position="bottom-right"
            nodeStrokeWidth={2}
            nodeClassName="!fill-accent/20 !stroke-accent"
            maskColor="var(--color-canvas)"
            className="!bg-surface !border !border-border !rounded-none !shadow-lg"
          />
          <Controls
            position="bottom-left"
            className="!rounded-none !shadow-lg [&_button]:!bg-surface [&_button]:!text-text-muted [&_button]:!border-border [&_button]:hover:!bg-surface-raised [&_button]:hover:!text-text [&_button]:!shadow-none"
          />
        </ReactFlow>

        {/* Legend */}
        <div className="absolute top-3 right-3 z-10 bg-surface border border-border rounded-none px-3 py-2 text-xs shadow-lg">
          <button
            type="button"
            onClick={() => setLegendOpen(!legendOpen)}
            className="flex items-center gap-1 font-semibold text-text w-full"
          >
            {legendOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            Relationships
          </button>
          {legendOpen && (
            <div className="mt-1.5">
              {LEGEND_ITEMS.map((item) => (
                <div key={item.cardinality} className="flex items-center gap-2 py-0.5">
                  <span
                    className="w-3 h-0.5 inline-block"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-text-muted font-mono text-[10px]">
                    {item.cardinality}
                  </span>
                  <span className="text-text-muted">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Powered by React Flow */}
        <div className="absolute top-0 left-0 z-0 text-[10px] text-text-muted/50 bg-surface/80 px-2 py-0.5 rounded-none pointer-events-none">
          Powered by React Flow
        </div>
      </div>
    </div>
  );
}