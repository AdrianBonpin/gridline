import { memo } from "react";
import {
  Banknote,
  Binary,
  Braces,
  CalendarClock,
  Clock,
  FileCode2,
  Fingerprint,
  Globe,
  Hash,
  Layers,
  ListChecks,
  Shapes,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Map a DB column data type (PostgreSQL / SQLite / MySQL strings) to a
 * representative lucide icon. Best-effort by string matching — unknown and
 * custom types fall back to the generic `Type` icon.
 */
export function getDataTypeIcon(dataType: string): LucideIcon {
  const t = dataType.toLowerCase().trim();

  if (t === "money") return Banknote; // money — numeric, but deserves its own icon
  if (/json/.test(t)) return Braces; // json, jsonb
  if (t.endsWith("[]")) return Layers; // array types: integer[], text[], ...
  if (/uuid/.test(t)) return Fingerprint; // uuid
  if (/bool/.test(t)) return ToggleLeft; // boolean, bool
  if (/bytea|blob|varbinary|^binary|bit/.test(t)) return Binary; // bytea, blob, binary, bit
  if (/timestamp|datetime/.test(t)) return CalendarClock; // timestamp, timestamptz, datetime
  if (/^date\b|^time\b|interval/.test(t)) return Clock; // date, time, interval
  if (/smallint|integer|bigint|serial|numeric|decimal|real|float|double|int2|int4|int8|number/.test(t))
    return Hash; // numeric types
  if (/enum/.test(t)) return ListChecks; // mysql ENUM(...)
  if (/xml/.test(t)) return FileCode2; // xml
  if (/inet|cidr|macaddr/.test(t)) return Globe; // network types
  if (/point|line|lseg|box|path|polygon|circle/.test(t)) return Shapes; // geometric types
  return Type; // text, character varying, and unknown/custom types
}

interface DataTypeIconProps {
  dataType: string;
  size?: number;
  className?: string;
  /** Tooltip / accessible label. Defaults to the raw data type string. */
  title?: string;
}

/** A compact icon representing a DB column's data type, with a tooltip. */
export const DataTypeIcon = memo(function DataTypeIcon({
  dataType,
  size = 12,
  className,
  title = dataType,
}: DataTypeIconProps) {
  const Icon = getDataTypeIcon(dataType);
  return (
    <span title={title} className={className}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
});