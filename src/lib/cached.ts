import { cache } from "react";
import { getSellerTenderView, getTenderView } from "./tender-data";

// One database read per request, shared by a tender's layout and its page.
export const tenderView = cache(getTenderView);
export const sellerTenderView = cache(getSellerTenderView);
