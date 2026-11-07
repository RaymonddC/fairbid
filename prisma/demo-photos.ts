// Placeholder product photos for the demo bids, drawn as SVG so the repo ships no
// image files. A seller who uploads real photos replaces them.

type Motif = "kawung" | "parang" | "dots";

function napkin(motif: Motif, ink: string, cloth: string, table: string, angle: number) {
  const pattern =
    motif === "kawung"
      ? `<pattern id="m" width="28" height="28" patternUnits="userSpaceOnUse">
           <ellipse cx="14" cy="6" rx="5" ry="7" fill="${ink}"/><ellipse cx="14" cy="22" rx="5" ry="7" fill="${ink}"/>
           <ellipse cx="6" cy="14" rx="7" ry="5" fill="${ink}"/><ellipse cx="22" cy="14" rx="7" ry="5" fill="${ink}"/>
           <circle cx="14" cy="14" r="2" fill="${cloth}"/></pattern>`
      : motif === "parang"
        ? `<pattern id="m" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
             <rect width="24" height="9" fill="${ink}"/><circle cx="12" cy="16.5" r="2.5" fill="${ink}"/></pattern>`
        : `<pattern id="m" width="18" height="18" patternUnits="userSpaceOnUse">
             <circle cx="9" cy="9" r="4" fill="${ink}"/></pattern>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <defs>${pattern}</defs>
    <rect width="400" height="300" fill="${table}"/>
    <g transform="rotate(${angle} 200 150)">
      <rect x="95" y="45" width="210" height="210" rx="4" fill="#000" opacity="0.12" transform="translate(6 8)"/>
      <rect x="95" y="45" width="210" height="210" rx="4" fill="${cloth}"/>
      <rect x="105" y="55" width="190" height="190" fill="url(#m)"/>
      <rect x="105" y="55" width="190" height="190" fill="none" stroke="${ink}" stroke-width="3"/>
    </g>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const DEMO_PHOTOS: Record<string, string[]> = {
  "seller-a": [napkin("parang", "#24306f", "#f4f2ec", "#cdb79a", -6), napkin("dots", "#24306f", "#f4f2ec", "#cdb79a", 4)],
  "seller-b": [napkin("dots", "#3a4a8a", "#efefef", "#9ea7a2", 3)],
  "seller-c": [napkin("dots", "#36478a", "#f1f1f1", "#a3a9a5", -3)],
  "seller-d": [napkin("kawung", "#1f2c78", "#f6f3ea", "#b58f63", -4), napkin("kawung", "#1f2c78", "#f6f3ea", "#7f5e3e", 8)],
};
