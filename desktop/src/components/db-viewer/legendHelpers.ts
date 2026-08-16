export interface LegendItem {
  cardinality: string;
  color: string;
  label: string;
  markerStart: string;
  markerEnd: string;
}

const CARDINALITY_COLORS: Record<string, string> = {
  "1:1": "#22c55e",
  "1:N": "#3b82f6",
  "N:M": "#f59e0b",
};

const CARDINALITY_LABELS: Record<string, string> = {
  "1:1": "One-to-One",
  "1:N": "One-to-Many",
  "N:M": "Many-to-Many",
};

export function getCardinalityColor(cardinality: string): string {
  return CARDINALITY_COLORS[cardinality] ?? "#6b7280";
}

export function getCardinalityLabel(cardinality: string): string {
  return CARDINALITY_LABELS[cardinality] ?? cardinality;
}

export const LEGEND_ITEMS: LegendItem[] = [
  { cardinality: "1:1", color: "#22c55e", label: "One-to-One", markerStart: "one", markerEnd: "one" },
  { cardinality: "1:N", color: "#3b82f6", label: "One-to-Many", markerStart: "many", markerEnd: "one" },
  { cardinality: "N:M", color: "#f59e0b", label: "Many-to-Many", markerStart: "many", markerEnd: "many" },
];