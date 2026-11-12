/**
 * Earthnow's icon set: one 24px grid, 1.8 stroke, round caps and joins.
 * Icons inherit `currentColor` and are hidden from assistive tech; the
 * control around them carries the accessible name.
 */
import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function make(paths: ReactNode) {
  return function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="icon"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconArrowRight = make(<path d="M5 12h14M13 6l6 6-6 6" />);
export const IconArrowLeft = make(<path d="M19 12H5M11 6l-6 6 6 6" />);
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconReturn = make(
  <>
    <path d="M4 9h11a5 5 0 0 1 0 10H8" />
    <path d="M8 5 4 9l4 4" />
  </>,
);
export const IconInfinity = make(<path d="M12 12c-2-2.7-3.6-4-5.5-4a4 4 0 0 0 0 8c1.9 0 3.5-1.3 5.5-4Zm0 0c2 2.7 3.6 4 5.5 4a4 4 0 0 0 0-8c-1.9 0-3.5 1.3-5.5 4Z" />);
export const IconHome = make(
  <>
    <path d="M4 10.5 12 4l8 6.5V20H4z" />
    <path d="M10 20v-5.5h4V20" />
  </>,
);
export const IconMap = make(
  <>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" />
    <path d="M9 4v14M15 6v14" />
  </>,
);
export const IconCalendar = make(
  <>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </>,
);
export const IconUsers = make(
  <>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 6M17.3 14.8c1.7.6 2.9 2.2 3.2 4.7" />
  </>,
);
export const IconPencil = make(
  <>
    <path d="M14.5 5.5 18.5 9.5 8.5 19.5H4.5v-4z" />
    <path d="m12.5 7.5 4 4" />
  </>,
);
export const IconTrophy = make(
  <>
    <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
    <path d="M8 6H4.5a3.5 3.5 0 0 0 3.8 3.5M16 6h3.5a3.5 3.5 0 0 1-3.8 3.5" />
    <path d="M12 13v3.5M8.5 20h7M9.5 20l.5-3.5h4l.5 3.5" />
  </>,
);
export const IconFlag = make(
  <>
    <path d="M5 21V4" />
    <path d="M5 4.5h11l-2.2 3.8L16 12H5" />
  </>,
);
export const IconPin = make(
  <>
    <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.8" r="2.3" />
  </>,
);
export const IconCopy = make(
  <>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.2" />
    <path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8" />
  </>,
);
export const IconShare = make(
  <>
    <path d="M12 4v11M7.5 8.5 12 4l4.5 4.5" />
    <path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" />
  </>,
);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconMinus = make(<path d="M5 12h14" />);
export const IconHeart = make(<path d="M12 19.5S4 14.7 4 9.2A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 8 2.2c0 5.5-8 10.3-8 10.3Z" />);
export const IconStar = make(<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />);
export const IconShield = make(<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z" />);
export const IconUser = make(
  <>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M5 20c.8-3.7 3.6-5.8 7-5.8s6.2 2.1 7 5.8" />
  </>,
);
