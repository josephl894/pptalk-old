/**
 * Hi-Fi icon set ported from `surfaces/parts.jsx`. Stroke 1.5, 16px viewBox.
 * Coral fill is left to callers via `text-coral` etc.
 */

import * as React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function svg(props: IconProps, paths: React.ReactNode, opts?: { fill?: boolean; viewBox?: string }) {
  const { size = 16, className, ...rest } = props;
  const fill = opts?.fill ? 'currentColor' : 'none';
  const stroke = opts?.fill ? undefined : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox={opts?.viewBox ?? '0 0 16 16'}
      fill={fill}
      stroke={stroke}
      strokeWidth={opts?.fill ? undefined : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {paths}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) =>
  svg(p, (<>
    <path d="M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V6.5Z" />
    <path d="M6.5 14V9.5h3V14" />
  </>));

export const WorkIcon = (p: IconProps) =>
  svg(p, (<>
    <rect x="2" y="3.5" width="12" height="10" rx="1.5" />
    <path d="M2 6.5h12" />
  </>));

export const VideosIcon = (p: IconProps) =>
  svg(p, (<>
    <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
    <path d="M7 6.5v3.5l3-1.75L7 6.5Z" fill="currentColor" />
  </>));

export const VoiceIcon = (p: IconProps) =>
  svg(p, (<>
    <path d="M8 2v8" />
    <path d="M5 4.5v3" />
    <path d="M11 4.5v3" />
    <path d="M3 6.5v0" />
    <path d="M13 6.5v0" />
    <path d="M5 13.5h6" />
    <path d="M8 11.5v2" />
  </>));

export const TrashIcon = (p: IconProps) =>
  svg(p, (<>
    <path d="M3 4.5h10" />
    <path d="M5 4.5V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
    <path d="M4.5 4.5 5 13a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-8.5" />
  </>));

export const PlusIcon = (p: IconProps) =>
  svg(p, <path d="M8 3v10M3 8h10" strokeWidth={1.6} />);

export const SearchIcon = (p: IconProps) =>
  svg(p, (<>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m13.5 13.5-3-3" />
  </>));

export const PlayIcon = (p: IconProps) =>
  svg(p, <path d="M5 3.5v9l7-4.5-7-4.5Z" />, { fill: true });

export const SparkleIcon = (p: IconProps) =>
  svg(p, (<>
    <path d="M8 1.5 9 6l4.5 1L9 8l-1 4.5L7 8l-4.5-1L7 6l1-4.5Z" />
    <path d="M13 11l.5 1.5L15 13l-1.5.5L13 15l-.5-1.5L11 13l1.5-.5L13 11Z" opacity=".6" />
  </>), { fill: true });

export const OutlineIcon = (p: IconProps) =>
  svg(p, (<>
    <path d="M3 4h2" />
    <path d="M7 4h6" />
    <path d="M3 8h2" />
    <path d="M7 8h6" />
    <path d="M3 12h2" />
    <path d="M7 12h6" />
  </>));

export const CloseIcon = (p: IconProps) =>
  svg(p, <path d="m4 4 8 8M12 4l-8 8" />);

export const DiamondIcon = (p: IconProps) => {
  const { size = 16, className, ...rest } = p;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden
      {...rest}
    >
      <path d="M8 2 14 8 8 14 2 8 8 2Z" />
    </svg>
  );
};
