"use client";

import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Transaction } from "@/lib/cashflow";
import { dayTime, money } from "@/lib/format";
import { Pill } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  browserColorScheme: "inherit",
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
  fontSize: 13,
  wrapperBorderRadius: 12,
  columnBorder: false,
});

const KIND: Record<Transaction["kind"], { label: string; tone: "dye" | "ok" | "plain" }> = {
  hold: { label: "Hold", tone: "dye" },
  payment: { label: "Paid", tone: "ok" },
  release: { label: "Released", tone: "plain" },
};

function KindCell({ value }: CustomCellRendererProps<Transaction, Transaction["kind"]>) {
  if (!value) return null;
  return (
    <div className="flex h-full items-center">
      <Pill tone={KIND[value].tone}>{KIND[value].label}</Pill>
    </div>
  );
}

function TenderCell({ data }: CustomCellRendererProps<Transaction>) {
  if (!data) return null;
  return (
    <Link href={`/tender/${data.tenderId}`} className="hover:text-dye hover:underline">
      {data.tenderTitle}
    </Link>
  );
}

/** Every hold, payment and release, newest first, from the event log. Sort any column, or search. */
export function TransactionsGrid({ txs, title, showSeller }: { txs: Transaction[]; title: string; showSeller: boolean }) {
  const [search, setSearch] = useState("");

  const cols = useMemo<ColDef<Transaction>[]>(
    () => [
      { headerName: "Date", field: "at", valueFormatter: (p) => dayTime(p.value), width: 130, sort: "desc" },
      { headerName: "Tender", field: "tenderTitle", cellRenderer: TenderCell, minWidth: 200, flex: 1 },
      ...(showSeller ? [{ headerName: "Seller", field: "sellerName", minWidth: 150, flex: 0.7 } as ColDef<Transaction>] : []),
      { headerName: "Step", field: "label", minWidth: 170, flex: 0.8 },
      { headerName: "Type", field: "kind", cellRenderer: KindCell, cellDataType: false, width: 110 },
      {
        headerName: "Amount",
        field: "amountCents",
        valueFormatter: (p) => (p.data ? money(p.value, p.data.currency) : ""),
        type: "rightAligned",
        width: 115,
        cellClass: "font-semibold",
      },
      { headerName: "PayPal ID", field: "ref", valueFormatter: (p) => p.value ?? "–", width: 170, cellClass: "ref text-xs" },
    ],
    [showSeller],
  );

  return (
    <section className="grid gap-3" aria-labelledby="tx-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 id="tx-title" className="text-base">
            {title}
          </h2>
          <p className="text-xs text-muted">Every row comes from the tender&apos;s tamper-evident event log.</p>
        </div>
        {txs.length > 0 && (
          <label className="relative">
            <span className="sr-only">Search transactions</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tender, step or PayPal ID"
              className="min-h-10 w-64 rounded-lg border border-line-strong bg-surface px-3 text-sm outline-none focus:border-dye focus:ring-2 focus:ring-dye/15"
            />
          </label>
        )}
      </div>
      {txs.length === 0 ? (
        <p className="text-sm text-muted">No money has moved yet.</p>
      ) : (
        <>
          {/* Phones: a plain list instead of a wide grid. */}
          <ul className="notice divide-y divide-line overflow-hidden rounded-xl sm:hidden">
            {txs.slice(0, 10).map((t, i) => (
              <li key={`${t.at}-${i}`} className="grid gap-0.5 px-4 py-3 text-sm">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{t.label}</span>
                  <span className="num font-semibold">{money(t.amountCents, t.currency)}</span>
                </span>
                <span className="text-xs text-muted">
                  {t.tenderTitle}, {dayTime(t.at)}
                </span>
              </li>
            ))}
          </ul>
          <div className="hidden sm:block">
            <AgGridReact<Transaction>
              theme={theme}
              rowData={txs}
              columnDefs={cols}
              quickFilterText={search}
              domLayout={txs.length > 10 ? "normal" : "autoHeight"}
              containerStyle={txs.length > 10 ? { height: 480 } : undefined}
              rowHeight={44}
              pagination={txs.length > 10}
              paginationPageSize={10}
              paginationPageSizeSelector={false}
              defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
            />
          </div>
        </>
      )}
    </section>
  );
}
