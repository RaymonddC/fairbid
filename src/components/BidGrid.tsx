"use client";

import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { nameGrid } from "@/lib/grid";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { useMemo, useRef } from "react";
import { moneyFor } from "@/lib/format";
import { rankBids, type BidView, type CriterionView } from "@/lib/views";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  browserColorScheme: "dark",
  accentColor: "var(--dye)",
  backgroundColor: "var(--surface)",
  borderColor: "var(--line)",
  foregroundColor: "var(--ink)",
  headerBackgroundColor: "var(--raised)",
  headerTextColor: "var(--muted)",
  headerFontWeight: 500,
  headerFontSize: 12,
  rowHoverColor: "var(--dye-soft)",
  fontFamily: "inherit",
  fontSize: 14,
  wrapperBorderRadius: 12,
  columnBorder: false,
});

export type Status = "Winner" | "Recommended" | "Coordinated" | "Over budget" | "Eligible";

export type Row = BidView & { totalCost: number; statuses: Status[]; score: number };

const tone: Record<Status, string> = {
  Winner: "bg-ok-soft text-ok",
  Recommended: "bg-ok-soft text-ok",
  Coordinated: "bg-warn-soft text-warn",
  "Over budget": "bg-flag-soft text-flag",
  Eligible: "bg-canvas text-muted",
};

export function StatusChips({ statuses, nowrap = false }: { statuses: Status[]; nowrap?: boolean }) {
  return (
    <span className={`flex items-center gap-1 ${nowrap ? "flex-nowrap" : "flex-wrap"}`}>
      {statuses.map((s) => (
        <span key={s} className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tone[s]}`}>
          {s === "Coordinated" ? "⚑ Coordinated" : s}
        </span>
      ))}
    </span>
  );
}

function StatusCell({ value }: CustomCellRendererProps<Row, Status[]>) {
  return (
    <div className="flex h-full items-center">
      <StatusChips statuses={value ?? []} nowrap />
    </div>
  );
}

/** Rows in score order, with every status that applies (a bid can be both over budget and coordinated). */
export function scoreRows(bids: BidView[], withVat: boolean, winnerId: string | null): Row[] {
  return rankBids(bids).map((b, i) => {
    const statuses: Status[] = [];
    if (winnerId === b.id) statuses.push("Winner");
    else if (i === 0 && !winnerId && !b.overBudget) statuses.push("Recommended");
    if (b.flagged) statuses.push("Coordinated");
    if (b.overBudget) statuses.push("Over budget");
    if (statuses.length === 0) statuses.push("Eligible");
    return { ...b, totalCost: withVat ? b.deliveredGrossCents : b.deliveredCents, statuses, score: b.total ?? 0 };
  });
}

/**
 * Blind score table, one column per published criterion. Until the buyer switches to delivered
 * cost (`revealed`), it shows quoted prices only, listed by price, so the ranking is not given away.
 */
export function BidGrid({
  bids,
  criteria,
  withVat,
  revealed,
  winnerId,
  currency,
}: {
  bids: BidView[];
  criteria: CriterionView[];
  withVat: boolean;
  revealed: boolean;
  winnerId: string | null;
  currency: string;
}) {
  const eur = useMemo(() => moneyFor(currency), [currency]);
  const gridBox = useRef<HTMLDivElement>(null);
  const scored = useMemo(() => scoreRows(bids, withVat, winnerId), [bids, withVat, winnerId]);
  const rows = useMemo(() => (revealed ? scored : [...scored].sort((a, b) => a.goodsCents - b.goodsCents)), [scored, revealed]);

  const cols = useMemo<ColDef<Row>[]>(() => {
    const list: ColDef<Row>[] = [{ headerName: "Bid", field: "letter", width: 64, pinned: "left" }];
    if (winnerId) list.push({ headerName: "Seller", valueGetter: (p) => p.data?.sellerName ?? "Hidden", minWidth: 150, flex: 1 });
    list.push({
      headerName: "Quoted",
      field: "goodsCents",
      valueFormatter: (p) => eur(p.value),
      type: "rightAligned",
      ...(revealed ? { width: 105 } : { flex: 1 }),
    });
    if (revealed) {
      list.push({
        headerName: withVat ? "Delivered incl. VAT" : "Delivered",
        field: "totalCost",
        valueFormatter: (p) => eur(p.value),
        width: withVat ? 160 : 110,
        type: "rightAligned",
        cellClass: "ag-right-aligned-cell font-semibold",
      });
      for (const c of criteria.filter((c) => c.kind !== "cost")) {
        list.push({
          headerName: c.name,
          headerTooltip: `${c.name}, ${c.weightPct}%: ${c.rubric}`,
          valueGetter: (p) => p.data?.scores.find((s) => s.criterionId === c.id)?.score,
          width: Math.max(90, c.name.length * 8 + 30),
          type: "rightAligned",
        });
      }
      list.push(
        { headerName: "Score", field: "score", valueFormatter: (p) => p.value.toFixed(1), width: 80, type: "rightAligned", cellClass: "ag-right-aligned-cell font-semibold" },
        { headerName: "Status", field: "statuses", cellRenderer: StatusCell, cellDataType: false, minWidth: 200, flex: 1, sortable: false },
      );
    }
    return list;
  }, [withVat, revealed, winnerId, criteria, eur]);

  return (
    <>
      {/* Phones: one card per bid instead of a wide table. */}
      <ul className="grid gap-3 sm:hidden">
        {rows.map((r) => (
          <li key={r.id} className="notice grid gap-2 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Bid {r.letter}</span>
              {revealed && <span className="font-semibold">{r.score.toFixed(1)}</span>}
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">Quoted {eur(r.goodsCents)}</span>
              {revealed && <span className="font-semibold">Delivered {eur(r.totalCost)}</span>}
            </div>
            {revealed && <StatusChips statuses={r.statuses} />}
          </li>
        ))}
      </ul>
      <div ref={gridBox} className="hidden w-full sm:block">
        {/* Remount when the column set changes, so AG Grid does not keep the old column widths. */}
        <AgGridReact<Row>
          key={`${revealed}-${withVat}-${winnerId ?? ""}`}
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          domLayout="autoHeight"
          rowHeight={52}
          getRowId={(p) => p.data.id}
          defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
          // Tab enters and leaves the table in one stop; arrow keys move between cells.
          tabToNextCell={() => false}
          onGridReady={() => nameGrid(gridBox.current, "Bids, scored blind")}
        />
      </div>
    </>
  );
}
