import type { SVGAttributes } from "react";

/* Decorative corner figure for the dashboard's total-documents card: a fanned
   stack of documents, the front one carrying a signature stroke and a seal.
   Drawn on theme tokens so it holds up in both themes. */
export function DocumentsFigure(props: SVGAttributes<SVGElement>) {
  return (
    <svg
      width="132"
      height="104"
      viewBox="0 0 132 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* back sheet */}
      <rect
        x="34"
        y="18"
        width="64"
        height="84"
        rx="6"
        transform="rotate(-8 34 18)"
        fill="var(--primary)"
        fillOpacity="0.08"
      />
      {/* middle sheet */}
      <rect
        x="48"
        y="14"
        width="64"
        height="84"
        rx="6"
        transform="rotate(-3 48 14)"
        fill="var(--primary)"
        fillOpacity="0.16"
      />
      {/* front sheet */}
      <rect
        x="62"
        y="12"
        width="64"
        height="84"
        rx="6"
        transform="rotate(3 62 12)"
        fill="var(--card)"
        stroke="var(--primary)"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      {/* text lines */}
      <g stroke="var(--primary)" strokeOpacity="0.3" strokeWidth="3" strokeLinecap="round">
        <path d="M73 28.5 L113 30.6" />
        <path d="M72 39.5 L112 41.6" />
        <path d="M71 50.5 L97 51.9" />
      </g>
      {/* signature stroke */}
      <path
        d="M70 76 C 75 66, 79 66, 80 73 C 81 79, 85 79, 88 71 C 90 66, 93 67, 93 72 C 93 77, 97 77, 101 72"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* seal */}
      <circle cx="112" cy="82" r="9" fill="var(--seal)" fillOpacity="0.85" />
      <circle
        cx="112"
        cy="82"
        r="5.5"
        stroke="var(--card)"
        strokeOpacity="0.85"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}
