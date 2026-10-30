// What a lazy route shows while its chunk loads. The blocks match the layout of the real pages.

export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="mb-8 space-y-3">
        <div className="hb-skeleton h-8 w-56" />
        <div className="hb-skeleton h-5 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="hb-skeleton h-56" />
        <div className="hb-skeleton h-56" />
      </div>
      <span className="sr-only">Loading.</span>
    </div>
  );
}

/** The play screen is full bleed, so its placeholder is a plain dark field. */
export function SessionSkeleton() {
  return <div role="status" aria-busy="true" aria-label="Loading" className="fixed inset-0 bg-bg" />;
}
