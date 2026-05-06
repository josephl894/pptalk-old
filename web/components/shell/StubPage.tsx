/**
 * Shared placeholder for Wave 1 stub routes (/videos, /voices, /trash).
 * Each route's full surface lands in Wave 2.
 */

import * as React from 'react';

export function StubPage({
  here,
  title,
  blurb,
  Icon,
}: {
  here: string;
  title: string;
  blurb: string;
  Icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <>
      <div className="pp-topbar">
        <div className="pp-crumbs">
          <span>Workspace</span>
          <span className="pp-sep">/</span>
          <span className="pp-here">{here}</span>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-10 py-6">
        <div className="flex max-w-[420px] flex-col items-center gap-4 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--paper-2)] text-[color:var(--ink-3)]">
            <Icon size={20} />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="t-20">{title}</h1>
            <p className="t-13 text-[color:var(--ink-3)]">{blurb}</p>
          </div>
          <span className="pp-tag is-outline">Coming soon</span>
        </div>
      </div>
    </>
  );
}
