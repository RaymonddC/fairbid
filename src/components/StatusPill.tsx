import type { TenderStatus } from "@/lib/tender";
import { Pill } from "./ui";

/** The tender's state in plain words for the buyer. */
export function StatusPill({ status, waiting = 0, heldCents }: { status: TenderStatus; waiting?: number; heldCents?: number }) {
  switch (status) {
    case "DRAFT":
      return <Pill>Draft</Pill>;
    case "OPEN":
      return (
        <Pill tone="dye" dot>
          Collecting sealed bids
        </Pill>
      );
    case "CLOSED":
    case "REVIEWING":
    case "CLARIFYING":
      return (
        <Pill tone="warn" dot>
          {waiting ? `Bids open, ${waiting} replies waiting` : "Bids open"}
        </Pill>
      );
    case "PRICED":
    case "SCORED":
      return (
        <Pill tone="warn" dot>
          Ready to award
        </Pill>
      );
    case "AWARDED":
    case "IN_DELIVERY":
      // Between phases of a long order, nothing is held until the buyer approves the next hold.
      return heldCents === 0 ? (
        <Pill tone="warn" dot>
          Next phase not held yet
        </Pill>
      ) : (
        <Pill tone="dye" dot>
          Money on hold with PayPal
        </Pill>
      );
    case "COMPLETE":
      return <Pill tone="ok">Paid</Pill>;
    case "CANCELLED":
      return <Pill tone="flag">Cancelled</Pill>;
  }
}
