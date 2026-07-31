import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { RotateCcw, ChevronUp, ChevronDown, Download, Loader2 } from "lucide-react";
import { toPng, toJpeg, toSvg } from "html-to-image";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { CrowsFootEdge } from "./CrowsFootEdge";
import { SchemaVisualizerNode } from "./SchemaVisualizerNode";
import { LEGEND_ITEMS } from "./legendHelpers";
import { SelectDropdown } from "../ui/SelectDropdown";
import { getSchemaGraph } from "../../lib/commands";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useNotificationStore } from "../../stores/notificationStore";
import type { SchemaGraph, TableNode as TableNodeType } from "../../lib/types";

const nodeTypes = { tableNode: SchemaVisualizerNode };
const edgeTypes = { crowsfoot: CrowsFootEdge };

const CARD_WIDTH = 240;
const ROW_HEIGHT = 28;
const HEADER_HEIGHT = 32;

// Export size for "Entire Schema" renders
const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 1000;

/**
 * Decode an html-to-image data URL (base64 or URL-encoded) into bytes so it
 * can be written to disk via the Tauri fs plugin.
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const [meta, payload] = dataUrl.split(",");
  const raw = /;base64/i.test(meta) ? atob(payload) : decodeURIComponent(payload);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

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
      width: CARD_WIDTH,
      height,
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

  // Export state
  const containerRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"schema" | "viewport">(
    "schema",
  );
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBackground, setExportBackground] = useState<
    "opaque" | "transparent"
  >("opaque");
  const transparent = exportBackground === "transparent";
  const notify = useNotificationStore((s) => s.notify);

  // Close the export menu on outside click (ignoring the trigger button)
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (exportButtonRef.current?.contains(target)) return;
      if (exportMenuRef.current?.contains(target)) return;
      setExportOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [exportOpen]);

  const handleExport = useCallback(
    async (scope: "schema" | "viewport", format: "png" | "jpeg" | "svg") => {
      const element = document.querySelector<HTMLElement>(
        ".react-flow__viewport",
      );
      if (!element) return;
      setExporting(true);
      setExportError(null);
      try {
        let width: number;
        let height: number;
        let style: Partial<CSSStyleDeclaration> | undefined;
        if (scope === "viewport") {
          const container = containerRef.current;
          width = container?.clientWidth || 1024;
          height = container?.clientHeight || 768;
        } else {
          width = EXPORT_WIDTH;
          height = EXPORT_HEIGHT;
          const bounds = getNodesBounds(nodes);
          if (bounds.width === 0 && bounds.height === 0) {
            throw new Error("Nothing to export");
          }
          const viewport = getViewportForBounds(
            bounds,
            width,
            height,
            0.5,
            2,
            0.05,
          );
          style = {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          };
        }

        const options = {
          // JPEG has no alpha channel; transparency only applies to PNG/SVG
          ...(transparent && format !== "jpeg"
            ? {}
            : { backgroundColor: "#0a0a0b" }),
          width,
          height,
          style,
          pixelRatio: 2,
        };
        const dataUrl =
          format === "png"
            ? await toPng(element, options)
            : format === "jpeg"
              ? await toJpeg(element, { ...options, quality: 0.95 })
              : await toSvg(element, options);

        // Filename: <db name>-<locale timestamp>.<ext>
        const dbName = currentDatabase ?? currentSchema ?? "schema";
        const timestamp = new Date()
          .toLocaleString()
          .replace(/[\\/:*?"<>|]/g, "-")
          .replace(/\s+/g, "-");
        const ext = format === "jpeg" ? "jpg" : format;
        const filename = `${dbName}-${timestamp}.${ext}`;

        const bytes = dataUrlToBytes(dataUrl);
        let savedPath: string | null = null;
        try {
          const path = await save({
            defaultPath: filename,
            filters: [
              { name: format.toUpperCase(), extensions: [ext] },
            ],
          });
          if (path) {
            await writeFile(path, bytes);
            savedPath = path;
          }
        } catch {
          // Not running in Tauri (e.g. plain browser dev): fall back to the
          // webview's default download handler.
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = filename;
          a.click();
        }
        if (savedPath) {
          notify(`Schema exported to ${savedPath}`, "success");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setExportError(`Export failed: ${msg}`);
      } finally {
        setExporting(false);
        setExportOpen(false);
      }
    },
    [nodes, currentSchema, currentDatabase, exportBackground, notify],
  );

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
          zIndex: 1000,
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
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border shrink-0 relative z-20">
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

        {/* Export */}
        <div className="flex items-center gap-2">
          {exportError && (
            <span className="text-[11px] text-red-400 max-w-56 truncate">
              {exportError}
            </span>
          )}
          <div className="relative">
            <button
              type="button"
              ref={exportButtonRef}
              onClick={() => setExportOpen((v) => !v)}
              disabled={exporting}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-raised disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Download size={12} />
              )}
              {exporting ? "Exporting…" : "Export"}
              <ChevronDown size={12} />
            </button>
            {exportOpen && !exporting && (
              <div
                ref={exportMenuRef}
                className="absolute right-0 top-full mt-1 z-30 w-52 rounded-lg bg-surface border border-border shadow-lg py-2 px-2"
              >
                <div className="px-1 pb-1.5 text-[10px] text-text-muted uppercase tracking-wider">
                  Scope
                </div>
                <SelectDropdown
                  value={exportScope}
                  onChange={(v) =>
                    setExportScope(v as "schema" | "viewport")
                  }
                  options={[
                    { value: "schema", label: "Entire Schema" },
                    { value: "viewport", label: "Viewport" },
                  ]}
                  aria-label="Export scope"
                  variant="pill"
                />
                <div className="px-1 pb-1.5 pt-1.5 text-[10px] text-text-muted uppercase tracking-wider">
                  Background
                </div>
                <SelectDropdown
                  value={exportBackground}
                  onChange={(v) =>
                    setExportBackground(v as "opaque" | "transparent")
                  }
                  options={[
                    { value: "opaque", label: "Opaque" },
                    { value: "transparent", label: "Transparent" },
                  ]}
                  aria-label="Export background"
                  variant="pill"
                />
                <div className="border-t border-border my-1.5" />
                {[
                  { format: "png" as const, label: "PNG" },
                  { format: "jpeg" as const, label: "JPEG" },
                  { format: "svg" as const, label: "SVG" },
                ]
                  .filter((f) => !(transparent && f.format === "jpeg"))
                  .map(({ format, label }) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => handleExport(exportScope, format)}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
                    >
                      {label}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 relative" ref={containerRef}>
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