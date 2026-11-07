import type { TenderStatus } from "@/lib/tender";
import { Pill } from "./ui";

/** The tender's state in plain words for the buyer. */
export function StatusPill({ status, waiting = 0 }: { status: TenderStatus; waiting?: number }) {
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
      return (
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
