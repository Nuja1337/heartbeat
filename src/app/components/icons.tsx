// Our own inline icons. 20 px by default, 16 px with size={16}, 1.5 stroke, no icon library.

import type { ReactNode } from 'react';

function Icon({ size = 20, children }: { size?: 16 | 20; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

type P = { size?: 16 | 20 };

/** Three sliders. Used for settings. */
export const IconSettings = (p: P) => (
  <Icon {...p}>
    <path d="M3 5.5h8M15 5.5h2M3 10h2M9 10h8M3 14.5h9M16 14.5h1" />
    <circle cx="13" cy="5.5" r="1.8" />
    <circle cx="7" cy="10" r="1.8" />
    <circle cx="14" cy="14.5" r="1.8" />
  </Icon>
);

export const IconDownload = (p: P) => (
  <Icon {...p}>
    <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 16.5h12" />
  </Icon>
);

export const IconRefresh = (p: P) => (
  <Icon {...p}>
    <path d="M16.5 10a6.5 6.5 0 1 1-2-4.7M16.5 3.5v3h-3" />
  </Icon>
);

export const IconHome = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 9 10 3.5 16.5 9M5 8v8h3.5v-4.5h3V16H15V8" />
  </Icon>
);

export const IconAlert = (p: P) => (
  <Icon {...p}>
    <path d="M10 3.5 17 16H3L10 3.5ZM10 8.5v3.2M10 13.8v.1" />
  </Icon>
);

export const IconCheck = (p: P) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);

export const IconArrow = (p: P) => (
  <Icon {...p}>
    <path d="M4 10h12m0 0-4.5-4.5M16 10l-4.5 4.5" />
  </Icon>
);

/** The reticle mark from the wordmark and the app icon. */
export function Reticle({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M2 6V2h4M14 2h4v4M18 14v4h-4M6 18H2v-4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square" />
      <circle cx="10" cy="10" r="2.6" fill="var(--color-accent)" />
    </svg>
  );
}
