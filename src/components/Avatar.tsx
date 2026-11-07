// Illustrated portraits instead of initials. Drawn in SVG, so no image files or
// licences, sharp at any size. Anna and Sari have their own; every other account gets
// a portrait picked from its id, so the same person always looks the same.

type Look = { skin: string; hair: string; shirt: string; bg: string; style: "bob" | "bun" | "short" | "long" | "curly" };

const SKIN = ["#f2d3bd", "#e8b896", "#c98e66", "#a8714e", "#7a4e33"];
const HAIR = ["#2b1d16", "#4a3022", "#7b4b2a", "#c9a063", "#1b1b1f"];
const SHIRT = ["#2e3fa3", "#1b7a4b", "#b2381f", "#8f5c00", "#5b3fa3", "#16707a"];
const BG = ["#eef0fc", "#e4f4ea", "#fbf0d6", "#fbe8e3", "#ece8fb", "#e1f2f4"];
const STYLES: Look["style"][] = ["bob", "bun", "short", "long", "curly"];

const KNOWN: Record<string, Look> = {
  // Anna, purchasing lead in Berlin.
  "buyer-anna": { skin: "#f2d3bd", hair: "#c9a063", shirt: "#2e3fa3", bg: "#eef0fc", style: "bob" },
  // Sari, batik workshop owner in Yogyakarta.
  "seller-sari": { skin: "#c98e66", hair: "#2b1d16", shirt: "#8f5c00", bg: "#fbf0d6", style: "bun" },
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function lookFor(id: string): Look {
  if (KNOWN[id]) return KNOWN[id];
  const h = hash(id);
  const pick = <T,>(list: T[], shift: number) => list[(h >>> shift) % list.length];
  return { skin: pick(SKIN, 0), hair: pick(HAIR, 4), shirt: pick(SHIRT, 8), bg: pick(BG, 12), style: pick(STYLES, 16) };
}

function Hair({ style, color }: { style: Look["style"]; color: string }) {
  switch (style) {
    case "bob":
      return <path d="M14 26c0-10 6-16 18-16s18 6 18 16v12h-5V26c-4 0-14-2-18-8-2 5-6 8-8 8v12h-5z" fill={color} />;
    case "bun":
      return (
        <>
          <circle cx="32" cy="9" r="6" fill={color} />
          <path d="M15 28c0-11 7-16 17-16s17 5 17 16c-3-5-9-8-17-8s-14 3-17 8z" fill={color} />
        </>
      );
    case "short":
      return <path d="M16 26c0-10 6-15 16-15s16 5 16 15c-4-5-9-6-16-6s-12 1-16 6z" fill={color} />;
    case "long":
      return <path d="M13 28c0-12 7-18 19-18s19 6 19 18v18h-6V28c-5-1-13-4-17-9-3 5-6 8-9 9v18h-6z" fill={color} />;
    case "curly":
      return (
        <g fill={color}>
          {[18, 24, 31, 38, 45].map((x, i) => (
            <circle key={x} cx={x} cy={i % 2 ? 13 : 16} r="6" />
          ))}
          <circle cx="15" cy="23" r="5" />
          <circle cx="49" cy="23" r="5" />
        </g>
      );
  }
}

/** A round portrait. Decorative by default: the name next to it carries the meaning. */
export function Avatar({ id, size = 32, label, ring = false }: { id: string; size?: number; label?: string; ring?: boolean }) {
  const look = lookFor(id);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`shrink-0 overflow-hidden rounded-full ${ring ? "ring-2 ring-dye ring-offset-2 ring-offset-canvas" : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {/* The round shape comes from rounded-full on the svg, so there is no clipPath id to collide. */}
      <g>
        <rect width="64" height="64" fill={look.bg} />
        {/* shoulders */}
        <path d="M8 64c2-12 11-18 24-18s22 6 24 18z" fill={look.shirt} />
        {/* neck and face */}
        <rect x="27" y="36" width="10" height="10" rx="4" fill={look.skin} />
        <ellipse cx="32" cy="28" rx="13" ry="14.5" fill={look.skin} />
        <Hair style={look.style} color={look.hair} />
        {/* face details, kept minimal */}
        <circle cx="27" cy="29" r="1.4" fill="#2b1d16" />
        <circle cx="37" cy="29" r="1.4" fill="#2b1d16" />
        <path d="M28.5 35c2 1.6 5 1.6 7 0" stroke="#7a3b2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}
