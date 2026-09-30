import { useId } from "react";

type StockIllustrationProps = { className?: string };

type CartonProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: string;
  left: string;
  right: string;
  tape: string;
  label?: boolean;
};

function Carton({ x, y, width, height, top, left, right, tape, label }: CartonProps) {
  const shoulder = width * 0.3;
  const front = shoulder * 2;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d={`M${-width} ${shoulder} 0 ${front} ${width} ${shoulder} 0 0Z`} fill={top} />
      <path d={`M${-width} ${shoulder} 0 ${front}V${front + height}L${-width} ${shoulder + height}Z`} fill={left} />
      <path d={`M0 ${front} ${width} ${shoulder}V${shoulder + height}L0 ${front + height}Z`} fill={right} />
      <path d={`M${-width * 0.62} ${shoulder * 0.62} ${width * 0.38} ${shoulder * 1.62} ${width * 0.62} ${shoulder * 1.38} ${-width * 0.38} ${shoulder * 0.38}Z`} fill={tape} opacity="0.68" />
      <path d={`M${width * 0.38} ${shoulder * 1.62} ${width * 0.62} ${shoulder * 1.38}V${shoulder * 1.38 + height * 0.3}L${width * 0.38} ${shoulder * 1.62 + height * 0.3}Z`} fill={tape} opacity="0.48" />
      <path d={`M${-width} ${shoulder} 0 ${front} ${width} ${shoulder}M0 ${front}V${front + height}`} fill="none" stroke="#102f2d" strokeOpacity="0.16" strokeWidth="1" />
      {label && (
        <g transform={`translate(${-width * 0.76} ${shoulder + height * 0.31}) skewY(16.7)`}>
          <rect width={width * 0.42} height={height * 0.35} rx="2" fill="#fcf9eb" opacity="0.93" />
          <path d={`M${width * 0.07} ${height * 0.085}h${width * 0.24}M${width * 0.07} ${height * 0.15}h${width * 0.13}`} fill="none" stroke="#597568" strokeWidth="1.5" strokeLinecap="round" />
          <path d={`M${width * 0.07} ${height * 0.23}v${height * 0.055}m${width * 0.05} ${-height * 0.055}v${height * 0.055}m${width * 0.04} ${-height * 0.055}v${height * 0.055}m${width * 0.06} ${-height * 0.055}v${height * 0.055}m${width * 0.04} ${-height * 0.055}v${height * 0.055}`} fill="none" stroke="#597568" strokeWidth="1.2" />
        </g>
      )}
    </g>
  );
}

export default function StockIllustration({ className }: StockIllustrationProps) {
  const id = useId().replace(/:/g, "");
  const platformId = `stock-platform-${id}`;
  const glowId = `stock-glow-${id}`;
  const gridId = `stock-grid-${id}`;

  return (
    <svg className={className} viewBox="0 0 480 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={platformId} x1="240" y1="115" x2="240" y2="253" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2d5145" />
          <stop offset="1" stopColor="#23473e" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientTransform="translate(246 161) rotate(90) scale(104 199)" gradientUnits="userSpaceOnUse">
          <stop stopColor="#baf264" stopOpacity="0.085" />
          <stop offset="1" stopColor="#baf264" stopOpacity="0" />
        </radialGradient>
        <clipPath id={gridId}>
          <path d="m240 110 205 66-205 75-205-75Z" />
        </clipPath>
      </defs>

      <ellipse cx="246" cy="162" rx="211" ry="113" fill={`url(#${glowId})`} />

      <path d="M65 164c-22 7-28 21-11 32l81 33c26 11 51 16 83 9l173-60c20-7 32-16 31-31v-32" stroke="#9ab9a2" strokeWidth="1.5" strokeDasharray="2 7" strokeLinecap="round" opacity="0.6" />
      <path d="m35 176 205 75 205-75v8l-205 75-205-75Z" fill="#173a32" />
      <path d="m240 110 205 66-205 75-205-75Z" fill={`url(#${platformId})`} stroke="#507563" strokeOpacity="0.65" />
      <g clipPath={`url(#${gridId})`} stroke="#7da485" strokeOpacity="0.13" strokeWidth="0.8">
        <path d="m70 144 236 81m-201-93 236 81m-200-93 236 81m-200-93 236 81m-200-93 236 81m-201-93 236 81" />
        <path d="m408 145-233 81m196-94-233 81m196-94-233 81m196-94-233 81m196-94-233 81m196-94-233 81" />
      </g>
      <path d="m55 177 20 7m13 5 17 6m284-1 23-9m12-5 6-2" stroke="#baf264" strokeWidth="2" strokeLinecap="round" opacity="0.75" />

      <path d="m105 169 89-31 183 54-126 45Z" fill="#0c2823" opacity="0.29" />

      <Carton x={142} y={106} width={44} height={43} top="#698e77" left="#4f7463" right="#365c4d" tape="#bbd4a9" />
      <Carton x={294} y={106} width={62} height={65} top="#92b292" left="#658971" right="#446d58" tape="#c2d6a8" label />
      <Carton x={294} y={55} width={62} height={51} top="#c7d8aa" left="#a0ba87" right="#7c9e72" tape="#eef1d3" />
      <Carton x={203} y={121} width={60} height={64} top="#fbf6df" left="#e0dbbd" right="#b4bb97" tape="#baf264" label />

      <path d="m262 225 58-21" stroke="#71977c" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m318 200 8 2-5 6" stroke="#71977c" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      <path d="m105 115-24-8V90m276 16 24-8V81" stroke="#86af8a" strokeWidth="1.2" strokeDasharray="2 5" strokeLinecap="round" opacity="0.7" />
      <circle cx="81" cy="83" r="8" fill="#294c3e" stroke="#789879" strokeOpacity="0.55" />
      <circle cx="81" cy="83" r="2.5" fill="#c3e797" />

      <path d="m386 66 12 7v14l-12 7-12-7V73Z" fill="#baf264" />
      <path d="m380 80 4 4 8-9" stroke="#254433" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m373 60 3 3m22-7-1 4m12 13-4 1" stroke="#baf264" strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />

      <circle cx="102" cy="205" r="4" fill="#102f2d" stroke="#8dad87" strokeWidth="1.5" />
      <circle cx="388" cy="156" r="4" fill="#baf264" />
      <circle cx="388" cy="156" r="9" stroke="#baf264" strokeOpacity="0.2" />
      <path d="M187 67h6m-3-3v6" stroke="#a0bb92" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <circle cx="220" cy="43" r="2" fill="#83a782" opacity="0.6" />
    </svg>
  );
}
