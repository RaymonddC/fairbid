import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkedSource, easyshipCode, pickTariff, rateFromEasyship, type RateRow } from "../duty";

const july = new Date("2026-07-01T00:00:00Z");
const nov = new Date("2026-11-10T02:00:00Z");
const DEMO: RateRow = { hsPrefix: "6302", destination: "DE", origin: "", dutyPct: 12, vatPct: 19, effectiveFrom: july, source: "Demo assumption" };
const ID_CHECKED: RateRow = { hsPrefix: "630251", destination: "DE", origin: "ID", dutyPct: 9.6, vatPct: 19, effectiveFrom: nov, source: "Easyship, 2026-11-10, preferential rate" };
const VN_CHECKED: RateRow = { ...ID_CHECKED, origin: "VN", dutyPct: 0 };
const ROWS = [DEMO, ID_CHECKED, VN_CHECKED];

describe("pickTariff", () => {
  it("uses the checked rate for the bid's own code and country of origin, with no warning", () => {
    const t = pickTariff(ROWS, "6302.51", "ID", "DE");
    assert.equal(t.dutyPct, 9.6);
    assert.equal(t.warning, null);
    assert.equal(t.source, ID_CHECKED.source);
    assert.equal(t.asOf, "2026-11-10");
  });

  it("prices the same goods by where they are made", () => {
    assert.equal(pickTariff(ROWS, "6302.51", "VN", "DE").dutyPct, 0);
  });

  it("borrows the broader rate, with a warning, when no checked rate fits the origin", () => {
    const t = pickTariff(ROWS, "6302.51", "CN", "DE");
    assert.equal(t.dutyPct, 12);
    assert.match(t.warning ?? "", /^Borrowed rate: .*6302\.51 made in China into Germany.*12% rate for 6302 \(Demo assumption\)/);
  });

  it("never borrows another country's checked rate before the origin-free rule", () => {
    assert.equal(pickTariff([DEMO, VN_CHECKED], "6302.51", "ID", "DE").dutyPct, 12);
  });

  it("borrows another code's rate when nothing matches, still with a warning", () => {
    const t = pickTariff([DEMO], "4202.22", "ID", "DE");
    assert.equal(t.dutyPct, 12);
    assert.ok(t.warning?.includes("4202.22"));
  });

  it("treats a 4-digit code as too broad to count as checked", () => {
    const four: RateRow = { ...ID_CHECKED, hsPrefix: "6302" };
    assert.ok(pickTariff([four], "6302", "ID", "DE").warning);
  });

  it("prefers the latest checked rate", () => {
    const newer = { ...ID_CHECKED, dutyPct: 8, effectiveFrom: new Date("2026-11-11T00:00:00Z") };
    assert.equal(pickTariff([...ROWS, newer], "6302.51", "ID", "DE").dutyPct, 8);
  });

  it("keeps the demo tender on the assumed rate, even when a checked rate exists, and says so", () => {
    const t = pickTariff(ROWS, "6302.51", "ID", "DE", { demo: true });
    assert.equal(t.dutyPct, 12);
    assert.match(t.warning ?? "", /^Demo rate: .*assumed 12% duty for 6302 \(Demo assumption\), not a rate checked for 6302\.51 made in Indonesia/);
  });

  it("ignores rules for other destinations and fails loudly with none", () => {
    assert.throws(() => pickTariff(ROWS, "6302.51", "ID", "US"), /No tariff rule for US/);
  });
});

describe("easyshipCode", () => {
  it("pads 6-digit codes to 8 and refuses headings", () => {
    assert.equal(easyshipCode("6302.51"), "63025100");
    assert.equal(easyshipCode("6302.51.10"), "63025110");
    assert.equal(easyshipCode("6302"), null);
    assert.equal(easyshipCode(null), null);
  });
});

describe("rateFromEasyship", () => {
  it("reads the base rate as a percentage", () => {
    const r = rateFromEasyship({
      tax_and_duty: { import_duty_details: [{ hs_code_applied: "6302510000", applied_rate_type: "fta", base_duty_rate: 0.096, additional_rates: [] }] },
    });
    assert.deepEqual(r, { dutyPct: 9.6, rateType: "fta", hsApplied: "6302510000", extras: [] });
  });

  it("adds stacked duties such as US Section 301", () => {
    const r = rateFromEasyship({
      tax_and_duty: {
        import_duty_details: [
          { applied_rate_type: "general", base_duty_rate: 0.063, additional_rates: [{ description: "Section 301 10%", rate: 0.1, amount: 12.75 }] },
        ],
      },
    });
    assert.equal(r?.dutyPct, 16.3);
    assert.equal(checkedSource(r!, nov), "Easyship, 2026-11-10, general rate, incl. Section 301 10%");
  });

  it("gives no rate for a flat small-parcel duty or a broken answer", () => {
    assert.equal(rateFromEasyship({ tax_and_duty: { duty: 3, import_duty_details: [] } }), null);
    assert.equal(rateFromEasyship(null), null);
    assert.equal(rateFromEasyship({ tax_and_duty: { import_duty_details: [{ base_duty_rate: "x" }] } }), null);
  });
});
