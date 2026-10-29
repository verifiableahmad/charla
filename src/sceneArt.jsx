import React from "react";

/* ---------- Scene illustrations ----------
   Flat drawings in the Charla palette, one per scene. Custom scenes pick the closest theme
   (the scene generator returns an "art" key; older scenes are matched by keyword).
   Every drawing shares a 320×140 canvas and is cropped to fill whatever box it sits in.
------------------------------------------- */
const C = {
  ink: "#1B2145", rosa: "#D6336C", rosaSoft: "#FCE7F0", paper: "#FFFDF7", sand: "#F3EEE2",
  leaf: "#2E7D4F", leafLight: "#7BC596", sun: "#F2B84B", orange: "#F28C38", clay: "#E0533D",
  sky: "#DCE8F5", leafSoft: "#E4F3E9", wood: "#8A5A12", woodLight: "#B07A3E", peach: "#FDE9C9", night: "#2B3366",
};

const Cloud = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} fill={C.paper}>
    <circle cx="0" cy="0" r="9" /><circle cx="11" cy="-5" r="11" /><circle cx="24" cy="0" r="9" /><rect x="0" y="0" width="24" height="9" />
  </g>
);

function Market() {
  const stripes = Array.from({ length: 10 }, (_, i) => i);
  return (
    <>
      <rect width="320" height="140" fill={C.peach} />
      <circle cx="276" cy="30" r="16" fill={C.sun} />
      <rect y="124" width="320" height="16" fill="#EBCB98" />
      <rect x="46" y="44" width="6" height="84" fill={C.ink} />
      <rect x="268" y="44" width="6" height="84" fill={C.ink} />
      {stripes.map(i => <rect key={i} x={34 + i * 25.2} y="34" width="25.2" height="22" fill={i % 2 ? C.paper : C.rosa} />)}
      {stripes.map(i => <path key={i} d={`M${34 + i * 25.2} 56a12.6 9 0 0 0 25.2 0z`} fill={i % 2 ? C.paper : C.rosa} />)}
      <rect x="34" y="30" width="252" height="6" rx="3" fill={C.ink} />
      <rect x="40" y="88" width="240" height="40" rx="4" fill={C.wood} />
      <rect x="40" y="88" width="240" height="7" rx="3" fill={C.woodLight} />
      <rect x="58" y="78" width="62" height="14" rx="2" fill="#6B4310" />
      {[66, 79, 92, 105, 72.5, 85.5, 98.5].map((x, i) => <circle key={i} cx={x} cy={i < 4 ? 76 : 67} r="7" fill={C.orange} />)}
      <rect x="132" y="78" width="62" height="14" rx="2" fill="#6B4310" />
      {[[142, 75], [158, 74], [174, 75], [150, 66], [166, 66]].map(([x, y], i) => (
        <g key={i} transform={`rotate(-20 ${x} ${y})`}><ellipse cx={x} cy={y} rx="9" ry="6.5" fill={C.sun} /><ellipse cx={x + 4} cy={y - 2} rx="4" ry="3" fill={C.orange} opacity=".6" /></g>
      ))}
      <rect x="206" y="78" width="56" height="14" rx="2" fill="#6B4310" />
      {[214, 226, 238, 250, 220, 232, 244].map((x, i) => <circle key={i} cx={x} cy={i < 4 ? 76 : 68} r="6" fill={i % 2 ? C.leaf : C.leafLight} />)}
      <rect x="150" y="100" width="40" height="18" rx="3" fill={C.paper} />
      <path d="M156 106h28M156 112h18" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

function Cafe() {
  return (
    <>
      <rect width="320" height="140" fill="#F3E3D3" />
      <rect x="196" y="12" width="104" height="72" rx="6" fill={C.paper} />
      <rect x="202" y="18" width="92" height="60" rx="3" fill={C.sky} />
      <path d="M248 18v60M202 48h92" stroke={C.paper} strokeWidth="5" />
      <Cloud x={214} y={36} s={0.7} />
      <path d="M112 0v22" stroke={C.ink} strokeWidth="2" />
      <path d="M96 38l8-16h16l8 16z" fill={C.rosa} />
      <circle cx="112" cy="42" r="5" fill={C.sun} />
      <rect x="20" y="98" width="280" height="9" rx="4" fill={C.wood} />
      <path d="M58 107v33M262 107v33" stroke={C.wood} strokeWidth="7" />
      <ellipse cx="112" cy="97" rx="30" ry="5" fill={C.paper} stroke={C.ink} strokeWidth="2.5" />
      <path d="M92 66h40v18a14 14 0 0 1-14 14h-12a14 14 0 0 1-14-14z" fill={C.paper} stroke={C.ink} strokeWidth="2.5" />
      <path d="M132 72a9 9 0 0 1 0 16" fill="none" stroke={C.ink} strokeWidth="2.5" />
      <ellipse cx="112" cy="67" rx="18" ry="3.5" fill="#6B4310" />
      <ellipse cx="210" cy="97" rx="30" ry="5" fill={C.paper} stroke={C.ink} strokeWidth="2.5" />
      <path d="M190 66h40v18a14 14 0 0 1-14 14h-12a14 14 0 0 1-14-14z" fill={C.rosa} stroke={C.ink} strokeWidth="2.5" />
      <path d="M190 72a9 9 0 0 0 0 16" fill="none" stroke={C.ink} strokeWidth="2.5" />
      <ellipse cx="210" cy="67" rx="18" ry="3.5" fill="#6B4310" />
      {[104, 118, 202, 216].map((x, i) => (
        <path key={i} d={`M${x} 58c-4-5 4-8 0-13s4-8 0-13`} fill="none" stroke={C.ink} strokeWidth="2" strokeLinecap="round" opacity=".35" />
      ))}
      <ellipse cx="160" cy="97" rx="20" ry="4" fill={C.paper} stroke={C.ink} strokeWidth="2" />
      <path d="M142 94c4-16 32-16 36 0c-4-4-8-5-12-5h-12c-4 0-8 1-12 5z" fill={C.sun} stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
      <path d="M153 88l2 6M160 86v8M167 88l-2 6" stroke={C.ink} strokeWidth="1.5" opacity=".45" strokeLinecap="round" />
    </>
  );
}

function Street() {
  const windows = (x, y, cols, rows, color) =>
    Array.from({ length: cols * rows }, (_, i) => (
      <rect key={i} x={x + (i % cols) * 16} y={y + Math.floor(i / cols) * 20} width="9" height="12" rx="1.5" fill={color} />
    ));
  return (
    <>
      <rect width="320" height="140" fill={C.sky} />
      <circle cx="40" cy="28" r="14" fill={C.sun} />
      <Cloud x={120} y={22} s={0.8} />
      <rect x="10" y="44" width="70" height="78" fill={C.clay} />
      {windows(20, 54, 4, 3, C.paper)}
      <rect x="84" y="28" width="62" height="94" fill="#EBC9A0" />
      {windows(93, 38, 3, 4, C.ink)}
      <path d="M90 64h50M90 84h50" stroke={C.ink} strokeWidth="2" />
      <rect x="150" y="52" width="78" height="70" fill={C.paper} />
      <path d="M150 52l39-16 39 16z" fill={C.rosa} />
      {windows(160, 62, 4, 3, C.sky)}
      <rect x="232" y="40" width="80" height="82" fill={C.sun} />
      {windows(242, 50, 4, 3, C.paper)}
      <rect y="118" width="320" height="8" fill={C.sand} />
      <rect y="126" width="320" height="14" fill="#5F6380" />
      <path d="M20 133h24M70 133h24M120 133h24M170 133h24M220 133h24M270 133h24" stroke={C.paper} strokeWidth="2.5" />
      <rect x="276" y="70" width="4" height="48" fill={C.ink} />
      <circle cx="278" cy="66" r="12" fill={C.rosa} stroke={C.paper} strokeWidth="2.5" />
      <rect x="271" y="60" width="14" height="10" rx="2" fill={C.paper} />
      <circle cx="274" cy="72" r="1.6" fill={C.paper} /><circle cx="282" cy="72" r="1.6" fill={C.paper} />
      <g transform="translate(118 46)">
        <path d="M0 0a14 14 0 0 1 14 14c0 11-14 24-14 24S-14 25-14 14A14 14 0 0 1 0 0z" fill={C.rosa} stroke={C.paper} strokeWidth="2.5" />
        <circle cx="0" cy="14" r="5" fill={C.paper} />
      </g>
    </>
  );
}

function Evening() {
  return (
    <>
      <rect width="320" height="140" fill={C.night} />
      <rect x="28" y="16" width="118" height="88" rx="6" fill={C.paper} />
      <rect x="34" y="22" width="106" height="76" rx="3" fill={C.ink} />
      <path d="M87 22v76M34 60h106" stroke={C.paper} strokeWidth="4" />
      <circle cx="112" cy="40" r="11" fill="#F6E7B8" />
      <circle cx="117" cy="36" r="10" fill={C.ink} />
      {[[50, 34], [70, 46], [58, 76], [118, 80], [100, 70]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.8" fill="#F6E7B8" />)}
      <circle cx="284" cy="58" r="30" fill={C.sun} opacity=".1" />
      <circle cx="284" cy="56" r="18" fill={C.sun} opacity=".16" />
      <path d="M284 60v66" stroke={C.paper} strokeWidth="3" />
      <path d="M270 54l6-18h16l6 18z" fill={C.sun} />
      <rect x="0" y="126" width="320" height="14" fill="#232A55" />
      <rect x="150" y="80" width="118" height="22" rx="10" fill="#B8285A" />
      <rect x="146" y="96" width="126" height="26" rx="8" fill={C.rosa} />
      <rect x="140" y="88" width="16" height="34" rx="7" fill="#B8285A" />
      <rect x="262" y="88" width="16" height="34" rx="7" fill="#B8285A" />
      <rect x="166" y="86" width="34" height="18" rx="7" fill={C.sun} />
      <path d="M150 122v4M268 122v4" stroke={C.ink} strokeWidth="4" />
      <rect x="98" y="104" width="34" height="5" rx="2" fill={C.woodLight} />
      <path d="M104 109v17M126 109v17" stroke={C.woodLight} strokeWidth="3" />
      <path d="M106 92h14v8a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" fill={C.paper} />
      <path d="M120 95a4 4 0 0 1 0 7" fill="none" stroke={C.paper} strokeWidth="2" />
    </>
  );
}

function Park() {
  const checks = Array.from({ length: 24 }, (_, i) => i);
  return (
    <>
      <rect width="320" height="140" fill={C.sky} />
      <circle cx="196" cy="34" r="16" fill={C.sun} />
      <Cloud x={92} y={26} s={0.9} />
      <Cloud x={222} y={52} s={0.6} />
      <path d="M0 92c60-24 120-24 180-6s100 6 140-6v60H0z" fill={C.leafLight} />
      <path d="M0 110c80-12 160-10 240 0s60 6 80 2v28H0z" fill="#9FD4AE" />
      <rect x="44" y="62" width="9" height="44" fill={C.wood} />
      <circle cx="48" cy="52" r="24" fill={C.leaf} />
      <circle cx="34" cy="64" r="15" fill={C.leaf} />
      <circle cx="64" cy="62" r="15" fill={C.leaf} />
      <g transform="translate(118 98) skewX(-24)">
        {checks.map(i => (
          <rect key={i} x={(i % 8) * 13} y={Math.floor(i / 8) * 9} width="13" height="9" fill={(i + Math.floor(i / 8)) % 2 ? C.paper : C.rosa} />
        ))}
      </g>
      <path d="M170 84h30l-4 18h-22z" fill={C.woodLight} />
      <path d="M174 84a11 11 0 0 1 22 0" fill="none" stroke={C.wood} strokeWidth="3" />
      <circle cx="150" cy="92" r="5" fill={C.clay} /><circle cx="160" cy="95" r="4" fill={C.orange} />
      <path d="M262 106c4-30 10-50 2-66M282 106c-2-26-10-42-4-58" fill="none" stroke={C.ink} strokeWidth="1.2" />
      <ellipse cx="262" cy="34" rx="12" ry="15" fill={C.rosa} />
      <ellipse cx="280" cy="42" rx="11" ry="14" fill={C.sun} />
    </>
  );
}

function Work() {
  return (
    <>
      <rect width="320" height="140" fill="#EEF0F7" />
      <circle cx="252" cy="36" r="20" fill={C.paper} stroke={C.ink} strokeWidth="3" />
      <path d="M252 24v12l8 6" stroke={C.ink} strokeWidth="3" strokeLinecap="round" fill="none" />
      <rect x="40" y="22" width="70" height="48" rx="4" fill={C.paper} />
      <path d="M50 36h40M50 46h50M50 56h30" stroke={C.sky} strokeWidth="5" strokeLinecap="round" />
      <rect x="20" y="102" width="280" height="10" rx="4" fill={C.wood} />
      <path d="M44 112v28M276 112v28" stroke={C.wood} strokeWidth="7" />
      <rect x="120" y="54" width="92" height="46" rx="5" fill={C.ink} />
      <rect x="126" y="60" width="80" height="34" rx="2" fill={C.sky} />
      <path d="M134 70h40M134 78h56M134 86h28" stroke={C.paper} strokeWidth="3" strokeLinecap="round" />
      <path d="M108 100h116l-6 4H114z" fill="#5F6380" />
      <rect x="238" y="80" width="22" height="22" rx="4" fill={C.clay} />
      <path d="M249 80c-12-8-14-22-6-26M249 80c10-6 16-18 10-26M249 80V56" stroke={C.leaf} strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M66 84h16v12a5 5 0 0 1-5 5h-6a5 5 0 0 1-5-5z" fill={C.rosa} />
      <path d="M82 88a4 4 0 0 1 0 8" fill="none" stroke={C.rosa} strokeWidth="2.5" />
    </>
  );
}

function Travel() {
  return (
    <>
      <rect width="320" height="140" fill={C.sky} />
      <Cloud x={40} y={30} s={1} />
      <Cloud x={230} y={70} s={0.7} />
      <path d="M30 100C90 70 170 30 250 34" fill="none" stroke={C.paper} strokeWidth="3" strokeDasharray="7 7" strokeLinecap="round" />
      <g transform="translate(262 32) rotate(-8)">
        <path d="M-22 0h40a6 6 0 0 1 0 8h-40z" fill={C.paper} />
        <path d="M-2 0l-14-18h8l16 18zM-2 8l-14 18h8l16-18z" fill={C.rosa} />
        <path d="M-22 0l-8-10h6l8 10z" fill={C.rosa} />
      </g>
      <rect y="122" width="320" height="18" fill={C.sand} />
      <rect x="110" y="56" width="84" height="66" rx="8" fill={C.rosa} />
      <rect x="138" y="44" width="28" height="14" rx="5" fill="none" stroke={C.ink} strokeWidth="5" />
      <path d="M126 56v66M178 56v66" stroke="#B8285A" strokeWidth="5" />
      <circle cx="152" cy="86" r="10" fill={C.sun} />
      <rect x="140" y="102" width="24" height="10" rx="3" fill={C.paper} />
      <circle cx="122" cy="126" r="4" fill={C.ink} /><circle cx="182" cy="126" r="4" fill={C.ink} />
      <rect x="208" y="88" width="46" height="34" rx="6" fill={C.leaf} />
      <path d="M222 88v-8h18v8" fill="none" stroke={C.ink} strokeWidth="4" />
    </>
  );
}

function Home() {
  return (
    <>
      <rect width="320" height="140" fill={C.peach} />
      <circle cx="58" cy="34" r="16" fill={C.sun} />
      <rect y="122" width="320" height="18" fill={C.leafLight} />
      <rect x="108" y="64" width="104" height="58" fill={C.paper} />
      <path d="M96 68l64-42 64 42z" fill={C.clay} />
      <rect x="184" y="34" width="14" height="22" fill={C.ink} />
      <rect x="148" y="86" width="24" height="36" rx="3" fill={C.rosa} />
      <circle cx="166" cy="104" r="2" fill={C.paper} />
      <rect x="118" y="78" width="22" height="20" rx="2" fill={C.sky} stroke={C.ink} strokeWidth="2" />
      <rect x="180" y="78" width="22" height="20" rx="2" fill={C.sun} stroke={C.ink} strokeWidth="2" />
      <rect x="252" y="80" width="8" height="42" fill={C.wood} />
      <circle cx="256" cy="72" r="20" fill={C.leaf} />
      <path d="M40 122c4-10 10-10 14 0M60 122c4-12 10-12 14 0" fill={C.leaf} />
    </>
  );
}

function Health() {
  return (
    <>
      <rect width="320" height="140" fill={C.leafSoft} />
      <rect y="122" width="320" height="18" fill={C.sand} />
      <rect x="70" y="40" width="180" height="82" fill={C.paper} />
      <rect x="62" y="32" width="196" height="12" rx="3" fill={C.leaf} />
      <rect x="92" y="62" width="58" height="60" rx="3" fill={C.sky} stroke={C.ink} strokeWidth="2" />
      <path d="M121 62v60" stroke={C.ink} strokeWidth="2" />
      <rect x="168" y="62" width="62" height="40" rx="3" fill={C.sky} stroke={C.ink} strokeWidth="2" />
      <g transform="translate(272 54)">
        <rect x="-4" y="22" width="8" height="46" fill={C.ink} />
        <rect x="-20" y="-20" width="40" height="40" rx="8" fill={C.leaf} />
        <path d="M-5-13h10v8h8v10h-8v8H-5V5h-8V-5h8z" fill={C.paper} />
      </g>
      <rect x="178" y="74" width="14" height="22" rx="3" fill={C.rosa} />
      <rect x="198" y="80" width="18" height="16" rx="3" fill={C.sun} />
    </>
  );
}

function Shop() {
  return (
    <>
      <rect width="320" height="140" fill={C.rosaSoft} />
      <rect y="124" width="320" height="16" fill="#F4CFDD" />
      <path d="M96 52h64l8 72H88z" fill={C.rosa} />
      <path d="M112 52v-8a16 16 0 0 1 32 0v8" fill="none" stroke={C.ink} strokeWidth="4" />
      <path d="M170 64h56l6 60h-68z" fill={C.sun} />
      <path d="M184 64v-6a14 14 0 0 1 28 0v6" fill="none" stroke={C.ink} strokeWidth="4" />
      <g transform="translate(250 48) rotate(14)">
        <path d="M0 0h34l10 12-10 12H0z" fill={C.paper} stroke={C.ink} strokeWidth="2.5" />
        <circle cx="34" cy="12" r="3" fill={C.ink} />
        <path d="M8 9h16M8 15h10" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="54" cy="38" r="10" fill={C.paper} opacity=".7" />
      <circle cx="30" cy="70" r="6" fill={C.paper} opacity=".7" />
    </>
  );
}

const BUBBLE = "M52 6A40 40 0 1 1 34.5 82L14 94L21.4 71.7A40 40 0 0 1 52 6Z";
function Talk() {
  return (
    <>
      <rect width="320" height="140" fill={C.sand} />
      <g transform="translate(78 14) scale(1.05)"><path d={BUBBLE} fill={C.rosa} /></g>
      <g transform="translate(246 30) scale(-0.9 0.9)"><path d={BUBBLE} fill={C.ink} /></g>
      <path d="M108 52h50M108 66h34" stroke={C.paper} strokeWidth="6" strokeLinecap="round" />
      <path d="M184 66h40M190 80h26" stroke={C.paper} strokeWidth="6" strokeLinecap="round" />
      <circle cx="40" cy="110" r="6" fill={C.sun} /><circle cx="286" cy="28" r="5" fill={C.leafLight} />
    </>
  );
}

const ART = { market: Market, cafe: Cafe, street: Street, evening: Evening, park: Park, work: Work, travel: Travel, home: Home, health: Health, shop: Shop, talk: Talk };
export const ART_KEYS = Object.keys(ART);

// Custom scenes made before the generator chose art get the closest theme by keyword.
const KEYWORDS = [
  ["market", /market|mercado|fruit|fruta|vendor|stall|haggl|regate/],
  ["work", /job|work|trabaj|interview|entrevista|office|oficina|meeting|reuni|boss|jefe/],
  ["cafe", /caf[eé]|coffee|restaurant|bar\b|tapas|food|comida|cena|dinner|lunch|breakfast|bakery|panader/],
  ["travel", /travel|viaj|airport|aeropuerto|hotel|flight|vuelo|train|tren|station|vacation|vacacion|trip/],
  ["street", /lost|perdid|direction|street|calle|city|ciudad|bus|taxi|metro/],
  ["health", /doctor|m[eé]dic|pharmac|farmacia|hospital|sick|enferm|dentist/],
  ["shop", /shop|tienda|store|buy|compr|cloth|ropa|gift|regalo/],
  ["home", /home|casa|family|familia|parent|padre|madre|neighbo|vecin|apartment|piso/],
  ["park", /weekend|fin de semana|park|parque|picnic|party|fiesta|plan|beach|playa|sport|deporte/],
  ["evening", /day|d[ií]a|night|noche|evening|tarde|feel|sient/],
];
export function artFor(sc) {
  if (sc?.art && ART[sc.art]) return sc.art;
  const text = `${sc?.title || ""} ${sc?.title_en || sc?.titleEn || ""} ${sc?.goal || ""}`.toLowerCase();
  return KEYWORDS.find(([, re]) => re.test(text))?.[0] || "talk";
}

export function SceneArt({ scene, className }) {
  const Drawing = ART[artFor(scene)];
  return (
    <svg className={className} viewBox="0 0 320 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <Drawing />
    </svg>
  );
}
