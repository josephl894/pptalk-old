/**
 * ProgressRing — circular determinate progress (SVG). Ported from `parts.jsx`.
 * Wave 1 doesn't render this anywhere yet; included so Wave 2 (My videos /
 * editor render banner) can drop it in without re-deriving the math.
 */

import * as React from 'react';

export function ProgressRing({
  pct = 0,
  size = 56,
  stroke = 4,
  label,
}: {
  pct?: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--paper-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct / 100)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center font-semibold"
        style={{ fontSize: size > 40 ? 13 : 11 }}
      >
        {label ?? `${Math.round(pct)}%`}
      </div>
    </div>
  );
}
