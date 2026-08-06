import { useMemo, useState } from "react";
import {
    BookMarked,
    FunctionSquare,
    GitBranch,
    ListChecks,
    ListOrdered,
    Puzzle,
    SquareFunction,
    Tag,
    Users,
} from "lucide-react";
import type {
    ObjectType,
    FunctionInfo,
    TriggerInfo,
    SequenceInfo,
    EnumInfo,
    ExtensionInfo,
    IndexInfo,
    ConstraintInfo,
} from "../../../lib/types";

export const TYPE_LABELS: Record<ObjectType, string> = {
    functions: "Functions",
    triggers: "Triggers",
    sequences: "Sequences",
    enums: "Enums",
    extensions: "Extensions",
    indexes: "Indexes",
    constraints: "Constraints",
    procedures: "Procedures",
    roles: "Roles",
};

export const SINGULAR_LABELS: Record<ObjectType, string> = {
    functions: "function",
    triggers: "trigger",
    sequences: "sequence",
    enums: "enum",
    extensions: "extension",
    indexes: "index",
    constraints: "constraint",
    procedures: "procedure",
    roles: "role",
};

export const OBJECT_ICONS: Record<ObjectType, React.ReactNode> = {
    functions: (
        <FunctionSquare size={14} className="text-text-muted shrink-0" />
    ),
    triggers: <GitBranch size={14} className="text-text-muted shrink-0" />,
    sequences: <ListOrdered size={14} className="text-text-muted shrink-0" />,
    enums: <Tag size={14} className="text-text-muted shrink-0" />,
    extensions: <Puzzle size={14} className="text-text-muted shrink-0" />,
    indexes: <BookMarked size={14} className="text-text-muted shrink-0" />,
    constraints: <ListChecks size={14} className="text-text-muted shrink-0" />,
    procedures: <SquareFunction size={14} className="text-text-muted shrink-0" />,
    roles: <Users size={14} className="text-text-muted shrink-0" />,
};

export type AnyObject =
    | FunctionInfo
    | TriggerInfo
    | SequenceInfo
    | EnumInfo
    | ExtensionInfo
    | IndexInfo
    | ConstraintInfo;

// ─── syntax highlighting for PL/pgSQL / SQL ──────────────

const SQL_KEYWORDS = new Set([
    "ADD",
    "ALL",
    "ALTER",
    "AND",
    "ANY",
    "AS",
    "ASC",
    "BEGIN",
    "BETWEEN",
    "BY",
    "CALL",
    "CASCADE",
    "CASE",
    "CAST",
    "CHECK",
    "CLOSE",
    "COLLATE",
    "COLUMN",
    "COMMIT",
    "CONSTRAINT",
    "CONTINUE",
    "CREATE",
    "CROSS",
    "CURRENT",
    "CURSOR",
    "DECLARE",
    "DEFAULT",
    "DELETE",
    "DESC",
    "DISTINCT",
    "DO",
    "DROP",
    "ELSE",
    "ELSIF",
    "END",
    "EXCEPTION",
    "EXECUTE",
    "EXISTS",
    "EXIT",
    "FETCH",
    "FOR",
    "FOREIGN",
    "FROM",
    "FULL",
    "FUNCTION",
    "GRANT",
    "GROUP",
    "HAVING",
    "IF",
    "IN",
    "INDEX",
    "INNER",
    "INSERT",
    "INTO",
    "IS",
    "JOIN",
    "KEY",
    "LANGUAGE",
    "LEFT",
    "LIMIT",
    "LOOP",
    "NOT",
    "NULL",
    "OF",
    "OFFSET",
    "ON",
    "OPEN",
    "OR",
    "ORDER",
    "OUTER",
    "OVER",
    "PERFORM",
    "PLPGSQL",
    "PRIMARY",
    "PROCEDURE",
    "QUERY",
    "RAISE",
    "REFERENCES",
    "REPLACE",
    "RETURN",
    "RETURNS",
    "REVOKE",
    "RIGHT",
    "ROLLBACK",
    "ROW",
    "ROWS",
    "SCHEMA",
    "SELECT",
    "SET",
    "STRICT",
    "TABLE",
    "THEN",
    "TO",
    "TRIGGER",
    "UNION",
    "UPDATE",
    "USING",
    "VALUES",
    "VIEW",
    "WHEN",
    "WHERE",
    "WHILE",
    "WITH",
]);

const SQL_TYPES = new Set([
    "BIGINT",
    "BIGSERIAL",
    "BIT",
    "BOOL",
    "BOOLEAN",
    "BPCHAR",
    "BYTEA",
    "CHAR",
    "CHARACTER",
    "DATE",
    "DECIMAL",
    "DOUBLE",
    "FLOAT",
    "FLOAT4",
    "FLOAT8",
    "INT",
    "INT2",
    "INT4",
    "INT8",
    "INTEGER",
    "INTERVAL",
    "JSON",
    "JSONB",
    "MONEY",
    "NAME",
    "NUMERIC",
    "OID",
    "REAL",
    "SERIAL",
    "SMALLINT",
    "TEXT",
    "TIME",
    "TIMESTAMP",
    "TIMESTAMPTZ",
    "UUID",
    "VARBIT",
    "VARCHAR",
    "VOID",
    "XML",
]);

interface Token {
    text: string;
    kind:
        | "keyword"
        | "type"
        | "string"
        | "comment"
        | "number"
        | "operator"
        | "plain";
}

function tokenizeLine(line: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < line.length) {
        if (/\s/.test(line[i])) {
            let ws = "";
            while (i < line.length && /\s/.test(line[i])) {
                ws += line[i];
                i++;
            }
            tokens.push({ text: ws, kind: "plain" });
            continue;
        }
        if (line[i] === "-" && line[i + 1] === "-") {
            tokens.push({ text: line.slice(i), kind: "comment" });
            return tokens;
        }
        if (line[i] === "/" && line[i + 1] === "*") {
            const end = line.indexOf("*/", i + 2);
            if (end !== -1) {
                tokens.push({ text: line.slice(i, end + 2), kind: "comment" });
                i = end + 2;
            } else {
                tokens.push({ text: line.slice(i), kind: "comment" });
                return tokens;
            }
            continue;
        }
        if (line[i] === "$") {
            let dollar = "";
            const start = i;
            while (i < line.length && line[i] === "$") {
                dollar += "$";
                i++;
            }
            let tag = "";
            if (dollar.length === 1 && i < line.length && line[i] !== "$") {
                while (i < line.length && line[i] !== "$") {
                    tag += line[i];
                    i++;
                }
                if (line[i] === "$") {
                    i++;
                    dollar = `$${tag}$`;
                }
            }
            const endTag = dollar;
            const endIdx = line.indexOf(endTag, i);
            if (endIdx !== -1) {
                tokens.push({
                    text: line.slice(start, endIdx + endTag.length),
                    kind: "string",
                });
                i = endIdx + endTag.length;
            } else {
                tokens.push({ text: line.slice(start), kind: "string" });
                return tokens;
            }
            continue;
        }
        if (line[i] === "'") {
            let str = "'";
            i++;
            while (i < line.length) {
                if (line[i] === "'" && line[i + 1] === "'") {
                    str += "''";
                    i += 2;
                    continue;
                }
                if (line[i] === "'") {
                    str += "'";
                    i++;
                    break;
                }
                str += line[i];
                i++;
            }
            tokens.push({ text: str, kind: "string" });
            continue;
        }
        if (/[0-9]/.test(line[i])) {
            let num = "";
            while (i < line.length && /[0-9.]/.test(line[i])) {
                num += line[i];
                i++;
            }
            tokens.push({ text: num, kind: "number" });
            continue;
        }
        if (/[=<>!+\-*/%&|^~@#;,.[\](){}]/.test(line[i])) {
            let op = line[i];
            i++;
            if (i < line.length) {
                const pair = op + line[i];
                if ([":=", "=>", "<=", ">=", "<>", "||", "::"].includes(pair)) {
                    op = pair;
                    i++;
                }
            }
            tokens.push({ text: op, kind: "operator" });
            continue;
        }
        let word = "";
        while (i < line.length && /[a-zA-Z_]/.test(line[i])) {
            word += line[i];
            i++;
        }
        if (word) {
            const upper = word.toUpperCase();
            if (SQL_KEYWORDS.has(upper)) {
                tokens.push({ text: word, kind: "keyword" });
            } else if (SQL_TYPES.has(upper)) {
                tokens.push({ text: word, kind: "type" });
            } else {
                tokens.push({ text: word, kind: "plain" });
            }
        } else {
            // Catch-all for any character not matched above (non-ASCII, symbols, etc.)
            tokens.push({ text: line[i], kind: "plain" });
            i++;
        }
    }
    return tokens;
}

function SyntaxCode({
    source,
    language: _language,
}: {
    source: string;
    language?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const maxLines = 60;

    // Memoize the tokenized output — source doesn't change while viewing
    const { displayLines, maxLineNum, truncated, totalLines } = useMemo(() => {
        const lines: string[] = source.split("\n");
        const total: number = lines.length;
        const isTruncated: boolean = !expanded && total > maxLines;
        const display: string[] = isTruncated
            ? lines.slice(0, maxLines)
            : lines;
        const maxNum: number = String(display.length).length;
        const tokenized = display.map((line: string) => ({
            tokens: tokenizeLine(line),
        }));
        return {
            displayLines: tokenized,
            maxLineNum: maxNum,
            truncated: isTruncated,
            totalLines: total,
        };
    }, [source, expanded]);

    const TOKEN_COLORS: Record<string, string> = {
        keyword: "text-blue-400",
        type: "text-emerald-400",
        string: "text-amber-300",
        comment: "text-text-subtle italic",
        number: "text-purple-400",
        operator: "text-text-muted",
        plain: "text-text",
    };

    return (
        <div>
            <div className="overflow-x-auto overscroll-x-none">
                <pre className="text-xs leading-6 font-mono whitespace-pre w-max min-w-full">
                    {displayLines.map(
                        (entry: { tokens: Token[] }, i: number) => {
                            const { tokens } = entry;
                            const num = String(i + 1).padStart(maxLineNum, " ");
                            return (
                                <div
                                    key={i}
                                    className="flex hover:bg-surface/30"
                                >
                                    <span
                                        className="inline-block text-right select-none text-text-subtle border-r border-border pr-3 mx-3 shrink-0"
                                        style={{
                                            minWidth: `${maxLineNum + 2}ch`,
                                        }}
                                    >
                                        {num}
                                    </span>
                                    <span className="flex-1 whitespace-pre">
                                        {tokens.length === 1 &&
                                        tokens[0].text.trim() === ""
                                            ? "\u00A0"
                                            : tokens.map((t, j) => (
                                                  <span
                                                      key={j}
                                                      className={
                                                          TOKEN_COLORS[t.kind]
                                                      }
                                                  >
                                                      {t.text}
                                                  </span>
                                              ))}
                                    </span>
                                </div>
                            );
                        },
                    )}
                </pre>
            </div>
            {truncated && (
                <div className="flex items-center justify-center py-1.5 border-t border-border">
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="text-xs text-accent hover:underline"
                    >
                        Show all {totalLines} lines…
                    </button>
                </div>
            )}
            {expanded && totalLines > maxLines && (
                <div className="flex items-center justify-center py-1.5 border-t border-border">
                    <button
                        type="button"
                        onClick={() => setExpanded(false)}
                        className="text-xs text-accent hover:underline"
                    >
                        Collapse
                    </button>
                </div>
            )}
        </div>
    );
}

function renderFunctionDetail(f: FunctionInfo) {
    return (
        <div>
            <div className="border-b border-border px-4 py-2">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    Signature
                </span>
            </div>
            <div className="border-b border-border flex flex-row">
                <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                    <span className="text-xs text-text-muted w-24 shrink-0">
                        Returns
                    </span>
                    <span className="text-sm text-accent font-mono">
                        {f.return_type || "void"}
                    </span>
                </div>
                <div className="px-4 py-2 flex items-center flex-2">
                    <span className="text-xs text-text-muted w-24 shrink-0">
                        Language
                    </span>
                    <span className="text-sm text-text">
                        {f.language}
                    </span>
                </div>
            </div>
            <div className="border-b border-border flex flex-row">
                <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                    <span className="text-xs text-text-muted w-24 shrink-0">
                        Kind
                    </span>
                    <span className="text-sm text-text">
                        {f.kind === "f" ? "Function" : "Procedure"}
                    </span>
                </div>
                <div className="px-4 py-2 flex items-center flex-2">
                    <span className="text-xs text-text-muted w-24 shrink-0">
                        Schema
                    </span>
                    <span className="text-sm text-text font-mono">
                        {f.schema}
                    </span>
                </div>
            </div>
            {f.argument_names.length > 0 && (
                <>
                    <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Arguments
                        </span>
                        <span className="text-[10px] text-text-subtle">
                            {f.argument_names.length} total
                        </span>
                    </div>
                    {f.argument_names.map((name, i) => (
                        <div
                            key={i}
                            className="border-b border-border px-4 py-2 flex items-center"
                        >
                            <div className="w-24 shrink-0">
                                <span className="text-xs text-text-muted">
                                    {f.argument_modes?.[i] &&
                                        f.argument_modes[i] !==
                                            "IN" && (
                                            <span className="text-amber-400 font-medium mr-1">
                                                {f.argument_modes[i]}
                                            </span>
                                        )}
                                    #{i + 1}
                                </span>
                            </div>
                            <span className="text-sm text-accent font-mono">
                                {name}
                            </span>
                            <span className="mx-2 text-border">:</span>
                            <span className="text-sm text-text-muted font-mono">
                                {f.argument_types?.[i] || "unknown"}
                            </span>
                        </div>
                    ))}
                </>
            )}
            {f.source && (
                <>
                    <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Source
                        </span>
                        <span className="text-[10px] text-text-subtle">
                            {f.language}
                        </span>
                    </div>
                    <SyntaxCode
                        source={f.source}
                        language={f.language}
                    />
                </>
            )}
        </div>
    );
}

function renderDetail(type: ObjectType, item: AnyObject) {
    switch (type) {
        case "functions":
            return renderFunctionDetail(item as FunctionInfo);
        case "procedures":
            return renderFunctionDetail(item as FunctionInfo);
        case "indexes": {
            const idx = item as IndexInfo;
            return (
                <div>
                    <div className="border-b border-border px-4 py-2">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Index
                        </span>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Table
                            </span>
                            <span className="text-sm text-text font-mono">
                                {idx.table}
                            </span>
                        </div>
                        <div className="px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Method
                            </span>
                            <span className="text-sm text-accent font-mono">
                                {idx.method}
                            </span>
                        </div>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Unique
                            </span>
                            <span
                                className={`text-sm ${idx.is_unique ? "text-emerald-400" : "text-text-muted"}`}
                            >
                                {idx.is_unique ? "Yes" : "No"}
                            </span>
                        </div>
                        <div className="px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Size
                            </span>
                            <span className="text-sm text-text font-mono">
                                {idx.size_bytes ?? "-"}
                            </span>
                        </div>
                    </div>
                    {idx.columns.length > 0 && (
                        <>
                            <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Columns
                                </span>
                                <span className="text-[10px] text-text-subtle">
                                    {idx.columns.length}
                                </span>
                            </div>
                            {idx.columns.map((col, i) => (
                                <div
                                    key={i}
                                    className="border-b border-border px-4 py-2 flex items-center"
                                >
                                    <span className="text-xs text-text-muted w-12 shrink-0 font-mono">
                                        #{i + 1}
                                    </span>
                                    <span className="text-sm text-accent font-mono">
                                        {col}
                                    </span>
                                </div>
                            ))}
                        </>
                    )}
                    {idx.definition && (
                        <>
                            <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Definition
                                </span>
                                <span className="text-[10px] text-text-subtle">
                                    SQL
                                </span>
                            </div>
                            <SyntaxCode source={idx.definition} />
                        </>
                    )}
                </div>
            );
        }
        case "constraints": {
            const c = item as ConstraintInfo;
            return (
                <div>
                    <div className="border-b border-border px-4 py-2">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Constraint
                        </span>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Type
                            </span>
                            <span className="text-sm text-accent font-mono">
                                {c.contype}
                            </span>
                        </div>
                        <div className="px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Table
                            </span>
                            <span className="text-sm text-text font-mono">
                                {c.table}
                            </span>
                        </div>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Deferrable
                            </span>
                            <span
                                className={`text-sm ${c.deferrable ? "text-amber-400" : "text-text-muted"}`}
                            >
                                {c.deferrable ? "Yes" : "No"}
                            </span>
                        </div>
                        <div className="px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Validated
                            </span>
                            <span
                                className={`text-sm ${c.validated ? "text-emerald-400" : "text-text-muted"}`}
                            >
                                {c.validated ? "Yes" : "No"}
                            </span>
                        </div>
                    </div>
                    {c.columns.length > 0 && (
                        <>
                            <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Columns
                                </span>
                                <span className="text-[10px] text-text-subtle">
                                    {c.columns.length}
                                </span>
                            </div>
                            {c.columns.map((col, i) => (
                                <div
                                    key={i}
                                    className="border-b border-border px-4 py-2 flex items-center"
                                >
                                    <span className="text-xs text-text-muted w-12 shrink-0 font-mono">
                                        #{i + 1}
                                    </span>
                                    <span className="text-sm text-accent font-mono">
                                        {col}
                                    </span>
                                </div>
                            ))}
                        </>
                    )}
                    {c.definition && (
                        <>
                            <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Definition
                                </span>
                                <span className="text-[10px] text-text-subtle">
                                    SQL
                                </span>
                            </div>
                            <SyntaxCode source={c.definition} />
                        </>
                    )}
                </div>
            );
        }
        case "triggers": {
            const t = item as TriggerInfo;
            return (
                <div>
                    <div className="border-b border-border px-4 py-2">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Details
                        </span>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border flex-2 px-4 py-2 flex items-center">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Table
                            </span>
                            <span className="text-sm text-text font-mono">
                                {t.table_schema}.{t.table_name}
                            </span>
                        </div>
                        <div className="flex-2 px-4 py-2 flex items-center">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Event
                            </span>
                            <span className="text-sm text-text">
                                {t.event_manipulation}
                            </span>
                        </div>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border flex-2 px-4 py-2 flex items-center">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Timing
                            </span>
                            <span className="text-sm text-text">
                                {t.action_timing} {t.action_orientation}
                            </span>
                        </div>
                        <div className="flex-2 px-4 py-2 flex items-center">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Status
                            </span>
                            <span
                                className={`text-sm ${t.enabled === "O" ? "text-emerald-400" : "text-red-400"}`}
                            >
                                {t.enabled === "O"
                                    ? "Enabled"
                                    : t.enabled === "D"
                                      ? "Disabled"
                                      : t.enabled}
                            </span>
                        </div>
                    </div>
                    <div className="border-b border-border px-4 py-2 flex items-center">
                        <span className="text-xs text-text-muted w-24 shrink-0">
                            Schema
                        </span>
                        <span className="text-sm text-text font-mono">
                            {t.schema}
                        </span>
                    </div>
                    {t.action_statement && (
                        <>
                            <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Definition
                                </span>
                                <span className="text-[10px] text-text-subtle">
                                    SQL
                                </span>
                            </div>
                            <SyntaxCode source={t.action_statement} />
                        </>
                    )}
                </div>
            );
        }
        case "sequences": {
            const s = item as SequenceInfo;
            return (
                <div>
                    <div className="border-b border-border px-4 py-2">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Sequence Values
                        </span>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-28 shrink-0">
                                Current Value
                            </span>
                            <span className="text-sm text-accent font-mono">
                                {s.current_value}
                            </span>
                        </div>
                        <div className="flex-2 px-4 py-2 flex items-center">
                            <span className="text-xs text-text-muted w-28 shrink-0">
                                Increment
                            </span>
                            <span className="text-sm text-text font-mono">
                                {s.increment}
                            </span>
                        </div>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-28 shrink-0">
                                Start
                            </span>
                            <span className="text-sm text-text font-mono">
                                {s.start_value}
                            </span>
                        </div>
                        <div className="flex-2 px-4 py-2 flex items-center">
                            <span className="text-xs text-text-muted w-28 shrink-0">
                                Min / Max
                            </span>
                            <span className="text-sm text-text font-mono">
                                {s.min_value} / {s.max_value}
                            </span>
                        </div>
                    </div>
                    <div className="border-b border-border px-4 py-2 flex items-center">
                        <span className="text-xs text-text-muted w-28 shrink-0">
                            Cycle
                        </span>
                        <span
                            className={`text-sm ${s.cycle ? "text-amber-400" : "text-text-muted"}`}
                        >
                            {s.cycle ? "Yes" : "No"}
                        </span>
                    </div>
                </div>
            );
        }
        case "enums": {
            const e = item as EnumInfo;
            return (
                <div>
                    <div className="border-b border-border px-4 py-2">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Details
                        </span>
                    </div>
                    <div className="border-b border-border px-4 py-2 flex items-center">
                        <span className="text-xs text-text-muted w-24 shrink-0">
                            Schema
                        </span>
                        <span className="text-sm text-text font-mono">
                            {e.schema}
                        </span>
                    </div>
                    <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Values
                        </span>
                        <span className="text-[10px] text-text-subtle">
                            {e.labels.length} labels
                        </span>
                    </div>
                    {e.labels.map((label, i) => (
                        <div
                            key={label}
                            className="border-b border-border px-4 py-2 flex items-center"
                        >
                            <span className="text-xs text-text-muted w-12 shrink-0 font-mono">
                                #{i + 1}
                            </span>
                            <span className="text-sm text-accent font-mono">
                                {label}
                            </span>
                        </div>
                    ))}
                </div>
            );
        }
        case "extensions": {
            const e = item as ExtensionInfo;
            return (
                <div>
                    <div className="border-b border-border px-4 py-2">
                        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Extension
                        </span>
                    </div>
                    <div className="border-b border-border flex flex-row">
                        <div className="border-r border-border px-4 py-2 flex items-center flex-2">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Version
                            </span>
                            <span className="text-sm text-text font-mono">
                                {e.version}
                            </span>
                        </div>
                        <div className="flex-2 px-4 py-2 flex items-center">
                            <span className="text-xs text-text-muted w-24 shrink-0">
                                Schema
                            </span>
                            <span className="text-sm text-text font-mono">
                                {e.schema}
                            </span>
                        </div>
                    </div>
                    {e.comment && (
                        <div className="border-b border-border px-4 py-2.5">
                            <span className="text-xs text-text-muted block mb-1">
                                Comment
                            </span>
                            <p className="text-sm text-text leading-relaxed">
                                {e.comment}
                            </p>
                        </div>
                    )}
                </div>
            );
        }
    }
}

interface ObjectDetailProps {
    connectionId: string;
    type: ObjectType;
    item: AnyObject;
}

export function ObjectDetail({ connectionId: _connectionId, type, item }: ObjectDetailProps) {
    return <>{renderDetail(type, item)}</>;
}