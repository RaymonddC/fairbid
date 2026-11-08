"use client";

import { useState, useTransition } from "react";
import { classifyHsAction, sellerReplyAction, submitBidAction } from "@/app/actions";
import { notifyError, notifySuccess } from "./ActionButton";
import { day, dayTime, moneyFor } from "@/lib/format";
import type { SellerTenderView } from "@/lib/views";
import { PageHeader } from "./PageHeader";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { Button, Panel, Pill } from "./ui";

type Lang = "en" | "id";

type HsState = { code: string; description: string; confidence: number; alternatives: { hsCode: string; description: string }[]; gate: number };

// Sari works in Indonesian; the buyer side stays in English. Only the seller screen switches.
const copy = {
  en: {
    title: "Your bid",
    lead: "Buyers compare every bid at the price delivered to their door, so an honest all-in price is the one that counts.",
    closes: "Closes",
    closed: "Bidding closed",
    scored: "Scored on",
    early: "Bidding early earns nothing.",
    refPhotos: "Reference photos from the buyer",
    selling: "What are you selling?",
    hsCode: "Customs code",
    confirmed: "Confirmed",
    right: "This is right",
    photos: "Photos of your product",
    photosHint: "Show the real product: the whole item, a close-up of the work, and the label or packing. At least one photo.",
    price: (q: number) => `Price for ${q} pieces (EUR)`,
    each: "each",
    ship: "Shipping to the door (EUR)",
    shipHint: "Door to door, all legs",
    fees: "Broker and document fees (EUR)",
    feesHint: "Paid by the buyer at import; counted so bids compare fairly",
    days: "Days to deliver",
    window: (d: number) => `The buyer needs it within ${d} days`,
    late: (d: number) => `${d} days past the buyer's window: this scores 0 on lead time`,
    seal: "Seal and send my bid",
    reseal: "Update my sealed bid",
    sealedAt: (at: string) => `Sealed ${at}. Nobody sees your price or photos before bidding closes.`,
    preview: "What the buyer will compare",
    goods: "Goods",
    shipping: "Shipping",
    duty: "Import duty",
    feesLine: "Broker fees",
    delivered: "Delivered cost",
    paid: "Paid to you through PayPal",
    within: (b: string) => `Within the ${b} budget`,
    over: (b: string) => `Over the ${b} budget`,
    vatNote: "Import VAT is the buyer's and is shown to them separately.",
    questions: "Questions from the buyer",
    none: "No questions for you.",
    answer: "Your answer",
    send: "Send answer",
    locked: "Your price is locked. An answer cannot change it.",
    won: "You won this tender",
    paidSoFar: "Paid to you so far",
  },
  id: {
    title: "Penawaran Anda",
    lead: "Pembeli membandingkan setiap penawaran dengan harga sampai di tempat mereka, jadi harga jujur yang sudah termasuk semuanya yang menang.",
    closes: "Ditutup",
    closed: "Penawaran ditutup",
    scored: "Dinilai dari",
    early: "Menawar lebih dulu tidak menambah nilai.",
    refPhotos: "Foto referensi dari pembeli",
    selling: "Apa yang Anda jual?",
    hsCode: "Kode HS (bea cukai)",
    confirmed: "Sudah dikonfirmasi",
    right: "Ini sudah benar",
    photos: "Foto produk Anda",
    photosHint: "Tunjukkan produk aslinya: utuh, close-up hasil kerja, dan label atau kemasan. Minimal satu foto.",
    price: (q: number) => `Harga untuk ${q} buah (EUR)`,
    each: "per buah",
    ship: "Ongkos kirim sampai tujuan (EUR)",
    shipHint: "Door to door, semua rute",
    fees: "Biaya broker dan dokumen (EUR)",
    feesHint: "Dibayar pembeli saat impor; dihitung supaya penawaran adil dibandingkan",
    days: "Lama pengiriman (hari)",
    window: (d: number) => `Pembeli butuh dalam ${d} hari`,
    late: (d: number) => `Lewat ${d} hari dari batas pembeli: nilai waktu kirim jadi 0`,
    seal: "Segel dan kirim penawaran",
    reseal: "Perbarui penawaran tersegel",
    sealedAt: (at: string) => `Disegel ${at}. Tidak ada yang bisa melihat harga atau foto Anda sebelum penawaran ditutup.`,
    preview: "Yang dibandingkan pembeli",
    goods: "Barang",
    shipping: "Ongkos kirim",
    duty: "Bea masuk",
    feesLine: "Biaya broker",
    delivered: "Total sampai tujuan",
    paid: "Dibayar ke Anda lewat PayPal",
    within: (b: string) => `Masih di bawah anggaran ${b}`,
    over: (b: string) => `Melebihi anggaran ${b}`,
    vatNote: "PPN impor ditanggung pembeli dan ditampilkan terpisah.",
    questions: "Pertanyaan dari pembeli",
    none: "Tidak ada pertanyaan untuk Anda.",
    answer: "Jawaban Anda",
    send: "Kirim jawaban",
    locked: "Harga Anda terkunci. Jawaban tidak bisa mengubahnya.",
    won: "Anda memenangkan tender ini",
    paidSoFar: "Sudah dibayar ke Anda",
  },
};

const euros = (cents: number | undefined) => (cents === undefined ? "" : String(Math.round(cents / 100)));

export function SellerBid({ t, sellerName }: { t: SellerTenderView; sellerName: string }) {
  const eur = moneyFor(t.currency);
  // Field labels name the tender's currency: (EUR) or (USD).
  const cur = (label: string) => label.replace("(EUR)", `(${t.currency})`);
  const [lang, setLang] = useState<Lang>("en");
  const c = copy[lang];
  const mine = t.myBid;
  const [total, setTotal] = useState(euros(mine?.goodsCents));
  const [shipping, setShipping] = useState(euros(mine?.shippingCents));
  const [fees, setFees] = useState(euros(mine?.feesCents));
  const [days, setDays] = useState(mine ? String(mine.leadTimeDays) : "");
  const [notes, setNotes] = useState(mine?.notes ?? "");
  const [hsConfirmed, setHsConfirmed] = useState(!!mine?.hsCode);
  // The HS classifier's guess. A saved bid keeps its confirmed code; otherwise the demo
  // product's code until the seller asks the classifier about what they wrote.
  const [hs, setHs] = useState<HsState>(() =>
    mine?.hsCode
      ? { code: mine.hsCode, description: "", confidence: 1, alternatives: [], gate: 0.7 }
      : { code: "6302.51", description: "table linen of cotton", confidence: 0.92, alternatives: [], gate: 0.7 },
  );
  const [classifying, startClassify] = useTransition();
  const classify = () =>
    startClassify(async () => {
      const r = await classifyHsAction(notes.trim() || t.spec.item);
      if (!r.ok) return notifyError(r.error);
      setHs({ code: r.guess.hsCode, description: r.guess.description, confidence: r.guess.confidence, alternatives: r.guess.alternatives, gate: r.gate });
      setHsConfirmed(false);
    });
  const [photos, setPhotos] = useState<string[]>(mine?.photos ?? []);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const goods = Math.round(Number(total || 0)) * 100;
  const ship = Math.round(Number(shipping || 0)) * 100;
  const fee = Math.round(Number(fees || 0)) * 100;
  const duty = Math.round((goods * t.dutyPct) / 100);
  const delivered = goods + ship + duty + fee;
  const lead = Math.round(Number(days || 0));
  const late = lead - t.spec.deliveryDays;
  const budget = eur(t.budgetCents);

  const blocker = !hsConfirmed
    ? lang === "en" ? "Confirm the customs code first." : "Konfirmasi kode HS dulu."
    : !goods || shipping === "" || lead <= 0
      ? lang === "en" ? "Fill in your price, shipping and days to deliver." : "Isi harga, ongkos kirim, dan lama pengiriman."
      : photos.length === 0
        ? lang === "en" ? "Add at least one photo." : "Tambahkan minimal satu foto."
        : null;

  const seal = () =>
    start(async () => {
      setMessage(null);
      const r = await submitBidAction(t.id, {
        goodsCents: goods,
        shippingCents: ship,
        feesCents: fee,
        leadTimeDays: lead,
        notes,
        hsCode: hs.code,
        photos,
      });
      setMessage(r.ok ? { ok: true, text: c.sealedAt(lang === "en" ? "just now" : "barusan") } : { ok: false, text: r.error });
      if (r.ok) notifySuccess([lang === "en" ? "Bid sealed" : "Penawaran tersegel", c.sealedAt(lang === "en" ? "just now" : "barusan")]);
      else notifyError(r.error);
    });

  return (
    <div lang={lang}>
      <PageHeader
        crumbs={[{ href: "/", label: lang === "en" ? "Open tenders" : "Tender terbuka" }]}
        title={t.title}
        description={`${sellerName}: ${c.lead}`}
        actions={
          <div className="flex rounded-lg bg-surface p-1 text-sm ring-1 ring-inset ring-line" role="group" aria-label="Language">
            {(["en", "id"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                lang={l}
                className={`min-h-10 rounded-md px-3 font-medium transition-colors ${lang === l ? "bg-dye-soft text-dye" : "text-muted hover:text-ink"}`}
              >
                {l === "en" ? "English" : "Bahasa Indonesia"}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-6">
          {t.won && (
            <Panel className="grid gap-3" featured>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg">{c.won}</h2>
                <Pill tone="ok">
                  {c.paidSoFar}: {eur(t.won.paidCents)} / {eur(t.won.holdCents)}
                </Pill>
              </div>
              <ol className="grid gap-1.5 text-sm">
                {t.won.milestones.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3">
                    <span className={m.capture ? "text-ok" : "text-muted"}>
                      {m.capture ? "✓ " : ""}
                      {m.name}
                    </span>
                    <span className="num">{eur(m.capture?.amountCents ?? m.plannedCents)}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel className="grid gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-[60ch] text-sm" lang="en">
                {t.needText}
              </p>
              <Pill tone={t.open ? "dye" : "plain"} dot={t.open}>
                {t.open ? `${c.closes} ${dayTime(t.closesAt)}` : c.closed}
              </Pill>
            </div>
            <p className="text-sm text-muted">
              {t.spec.quantity} × {t.spec.item}, {t.spec.deliverTo}, {t.spec.deliveryDays} days. {c.scored}{" "}
              {t.criteria.map((cr) => `${cr.name.toLowerCase()} ${cr.weightPct}%`).join(", ")}. {c.early}
            </p>
            {t.photos.length > 0 && (
              <div className="grid gap-2 border-t border-line pt-3">
                <h3 className="text-sm font-semibold">{c.refPhotos}</h3>
                <PhotoStrip photos={t.photos} label={c.refPhotos} />
              </div>
            )}
          </Panel>

          <Panel className="grid gap-5">
            <h2 className="text-lg">{c.title}</h2>
            <fieldset disabled={!t.open || pending} className="grid gap-5 disabled:opacity-70">
              <div className="grid gap-2">
                <label htmlFor="notes" className="text-sm font-medium">
                  {c.selling}
                </label>
                <input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 outline-none focus:border-dye focus:ring-2 focus:ring-dye/15"
                />
                <div className="grid gap-2 rounded-lg bg-canvas p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      {c.hsCode} <strong className="num">{hs.code}</strong>
                      {hs.description && `, ${hs.description.charAt(0).toLowerCase()}${hs.description.slice(1)}`}
                    </span>
                    <Pill tone={hsConfirmed ? "ok" : hs.confidence < hs.gate ? "flag" : "warn"}>
                      {hsConfirmed
                        ? c.confirmed
                        : hs.confidence < hs.gate
                          ? lang === "en" ? "Unsure: pick the code" : "Kurang yakin: pilih kodenya"
                          : `${Math.round(hs.confidence * 100)}% ${lang === "en" ? "sure" : "yakin"}`}
                    </Pill>
                    {!hsConfirmed && (
                      <button type="button" onClick={() => setHsConfirmed(true)} className="ml-auto min-h-11 px-1 font-medium text-dye underline underline-offset-4">
                        {c.right}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={classify} disabled={classifying} className="min-h-9 rounded-md px-1 text-xs font-medium text-dye underline underline-offset-4 disabled:opacity-60">
                      {classifying ? (lang === "en" ? "Checking…" : "Memeriksa…") : lang === "en" ? "Check the code for what I wrote" : "Periksa kode untuk produk saya"}
                    </button>
                    {hs.alternatives.map((a) => (
                      <button
                        key={a.hsCode}
                        type="button"
                        onClick={() => {
                          setHs((prev) => ({ ...prev, code: a.hsCode, description: a.description, alternatives: [{ hsCode: prev.code, description: prev.description }, ...prev.alternatives.filter((x) => x.hsCode !== a.hsCode)] }));
                          setHsConfirmed(true);
                        }}
                        className="min-h-9 rounded-md border border-line-strong bg-surface px-2 text-xs"
                      >
                        <span className="num font-medium">{a.hsCode}</span> {a.description}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <PhotoPicker photos={photos} onChange={setPhotos} label={c.photos} hint={c.photosHint} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="total"
                  label={cur(c.price(t.spec.quantity))}
                  value={total}
                  onChange={setTotal}
                  hint={goods && t.spec.quantity ? `${eur(goods / t.spec.quantity, 2)} ${c.each}` : ""}
                />
                <Field id="ship" label={cur(c.ship)} value={shipping} onChange={setShipping} hint={c.shipHint} />
                <Field id="fees" label={cur(c.fees)} value={fees} onChange={setFees} hint={c.feesHint} />
                <Field
                  id="days"
                  label={c.days}
                  value={days}
                  onChange={setDays}
                  hint={late > 0 ? c.late(late) : c.window(t.spec.deliveryDays)}
                  invalid={late > 0}
                />
              </div>
            </fieldset>

            {t.open && (
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <Button onClick={seal} loading={pending} disabled={!!blocker}>
                  {mine ? c.reseal : c.seal}
                </Button>
                <span className={`text-sm ${message && !message.ok ? "text-flag" : "text-muted"}`} aria-live="polite">
                  {message?.text ?? blocker ?? (mine ? c.sealedAt(dayTime(mine.submittedAt)) : "")}
                </span>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Panel className="grid gap-3">
            <h3 className="font-semibold">{c.preview}</h3>
            {photos.length > 0 && <PhotoStrip photos={photos} label={c.photos} size="sm" />}
            <dl className="grid gap-1.5 text-sm">
              <Line label={c.goods} value={goods ? eur(goods) : "—"} />
              <Line label={c.shipping} value={shipping !== "" ? eur(ship) : "—"} />
              <Line label={`${c.duty} (${t.dutyPct}%)`} value={goods ? eur(duty) : "—"} />
              <Line label={c.feesLine} value={fees !== "" ? eur(fee) : "—"} />
              <div className="mt-1 flex justify-between border-t border-line pt-2 text-base">
                <dt className="font-semibold">{c.delivered}</dt>
                <dd className="num font-semibold">{goods ? eur(delivered) : "—"}</dd>
              </div>
              <Line label={c.paid} value={goods ? eur(goods + ship) : "—"} />
            </dl>
            {goods > 0 && <Pill tone={delivered <= t.budgetCents ? "ok" : "flag"}>{delivered <= t.budgetCents ? c.within(budget) : c.over(budget)}</Pill>}
            <p className="text-xs text-muted">{c.vatNote}</p>
          </Panel>

          <Panel className="grid gap-3">
            <h3 className="font-semibold">{c.questions}</h3>
            {t.questions.length === 0 && <p className="text-sm text-muted">{c.none}</p>}
            {t.questions.map((q) => (
              <Question key={q.id} q={q} c={c} />
            ))}
          </Panel>
        </div>
      </div>
      <p className="mt-6 text-xs text-faint">Delivery deadline counted from the close: {day(new Date(new Date(t.closesAt).getTime() + t.spec.deliveryDays * 86_400_000).toISOString())}.</p>
    </div>
  );
}

function Question({ q, c }: { q: SellerTenderView["questions"][number]; c: (typeof copy)["en"] }) {
  const [reply, setReply] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <p className="rounded-lg bg-canvas p-3 text-sm" lang="en">
        {q.question}
      </p>
      {q.myReply ? (
        <p className="rounded-lg bg-ok-soft p-3 text-sm">{q.myReply}</p>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await sellerReplyAction(q.id, reply);
              setError(r.ok ? null : r.error);
              if (r.ok) notifySuccess(["Answer sent", c.locked]);
              else notifyError(r.error);
            });
          }}
        >
          <label htmlFor={`reply-${q.id}`} className="sr-only">
            {c.answer}
          </label>
          <textarea
            id={`reply-${q.id}`}
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className="rounded-lg border border-line bg-surface p-2 text-base outline-none focus:border-dye"
          />
          <p className="text-xs text-muted">{c.locked}</p>
          <Button type="submit" variant="secondary" loading={pending} disabled={!reply.trim()}>
            {c.send}
          </Button>
          {error && <p className="text-xs text-flag">{error}</p>}
        </form>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  invalid = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
  invalid?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step="1"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        className={`num min-h-11 rounded-lg border bg-surface px-3 outline-none focus:border-dye focus:ring-2 focus:ring-dye/15 ${invalid ? "border-flag" : "border-line-strong"}`}
      />
      <span id={`${id}-hint`} className={`text-xs ${invalid ? "text-flag" : "text-muted"}`}>
        {hint}
      </span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );
}
