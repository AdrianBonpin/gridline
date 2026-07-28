import { useCallback, useEffect, useMemo, useState } from "react";
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
import { CrowsFootEdge } from "./CrowsFootEdge";
import { SchemaVisualizerNode } from "./SchemaVisualizerNode";
import { LEGEND_ITEMS } from "./legendHelpers";
import { SelectDropdown } from "../ui/SelectDropdown";
import { getSchemaGraph } from "../../lib/commands";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { SchemaGraph, TableNode as TableNodeType } from "../../lib/types";

const nodeTypes = { tableNode: SchemaVisualizerNode };
const edgeTypes = { crowsfoot: CrowsFootEdge };

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
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100, marginx: 40, marginy: 40 });

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
            type: "crowsfoot",
            label: cardinality,
            data: { cardinality, startMarker: markers.markerStart, endMarker: markers.markerEnd, origRight: true },
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
      return { markerStart: "one", markerEnd: "one" };
    case "0..1:0..1":
      return { markerStart: "one", markerEnd: "one" };
    case "1:N":
      return { markerStart: "many", markerEnd: "one" };
    case "0..N":
      return { markerStart: "many", markerEnd: "one" };
    case "N:M":
      return { markerStart: "many", markerEnd: "many" };
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
  const [highlightedEdge, setHighlightedEdge] = useState<string | null>(null);

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
    setHighlightedEdge(null);
  }, [fetchGraph]);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setHighlightedEdge(edge.id === highlightedEdge ? null : edge.id);
    },
    [highlightedEdge],
  );

  const handlePaneClick = useCallback(() => {
    setHighlightedEdge(null);
  }, []);

  // Derive edges with highlighting applied
  const displayEdges = useMemo(() => {
    if (!highlightedEdge) return edges;
    return edges.map((e) => {
      if (e.id === highlightedEdge) {
        return {
          ...e,
          style: { ...e.style, stroke: "#f59e0b", strokeWidth: 2.5, opacity: 1 },
          labelStyle: { ...e.labelStyle, fill: "#f59e0b" },
          labelBgStyle: { ...e.labelBgStyle, fill: "#1f2937", fillOpacity: 0.95 },
        };
      }
      return { ...e, style: { ...e.style, opacity: 0.15 } };
    });
  }, [edges, highlightedEdge]);

  const highlightedCardinality = useMemo(() => {
    if (!highlightedEdge) return null;
    const edge = edges.find((e) => e.id === highlightedEdge);
    return (edge?.data as any)?.cardinality as string | null;
  }, [edges, highlightedEdge]);

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
      <div className="flex-1 min-h-0 relative">
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
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
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
            maskColor="rgba(18,18,24,0.85)"
            maskStrokeColor="var(--color-border)"
            maskStrokeWidth={1}
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
            <div className="mt-2 space-y-1.5">
              {LEGEND_ITEMS.map((item) => {
                const isActive = highlightedCardinality === item.cardinality;
                return (
                <div key={item.cardinality} className={`flex items-center gap-2.5 transition-opacity ${highlightedCardinality && !isActive ? "opacity-20" : ""}`}>
                  <svg width="36" height="12" className="shrink-0">
                    <line x1={6} y1={6} x2={30} y2={6} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} />
                    {/* Start marker */}
                    {item.markerStart === "one" ? (
                      <line x1={6} y1={2} x2={6} y2={10} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                    ) : (
                      <>
                        <line x1={6} y1={3} x2={12} y2={6} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                        <line x1={6} y1={6} x2={12} y2={6} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                        <line x1={6} y1={9} x2={12} y2={6} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                      </>
                    )}
                    {/* End marker */}
                    {item.markerEnd === "one" ? (
                      <line x1={30} y1={2} x2={30} y2={10} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                    ) : (
                      <>
                        <line x1={30} y1={3} x2={24} y2={6} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                        <line x1={30} y1={6} x2={24} y2={6} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                        <line x1={30} y1={9} x2={24} y2={6} stroke={isActive ? "#f59e0b" : item.color} strokeWidth={isActive ? 2 : 1.5} strokeLinecap="round" />
                      </>
                    )}
                  </svg>
                  <span className={`text-[11px] ${isActive ? "text-amber-400 font-medium" : "text-text-muted"}`}>{item.label}</span>
                </div>
              )})}
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