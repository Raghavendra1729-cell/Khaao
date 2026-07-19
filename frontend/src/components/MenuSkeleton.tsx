/**
 * Loading placeholder for the student Menu page (F15). Shaped like the real
 * layout — title, trending rail, section header + diet filter, and a stack of
 * menu rows (photo square + two text bones + a stepper-shaped block) — so the
 * page doesn't visibly reflow once real data lands. `animate-soft-pulse` is
 * already in index.css's `prefers-reduced-motion` kill-list, so this is
 * static (not shimmering) for anyone who has that preference on.
 */

/** A pulsing placeholder block. `rounded` is left to the caller so each bone
 * can match the corner radius of the real element it stands in for. */
function Bone({ className = '' }: { className?: string }) {
  return <div className={`animate-soft-pulse bg-edge/50 ${className}`} />;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-edge bg-paper p-3 shadow-card">
      <Bone className="h-16 w-16 shrink-0 rounded-lg bg-edge/60" />
      <div className="min-w-0 flex-1 space-y-2">
        <Bone className="h-4 w-3/5 rounded bg-edge/60" />
        <Bone className="h-3 w-2/5 rounded bg-edge/35" />
      </div>
      <Bone className="h-11 w-28 shrink-0 rounded-xl bg-edge/45" />
    </div>
  );
}

export function MenuSkeleton() {
  return (
    <div className="pb-28">
      <span role="status" className="sr-only">
        Loading menu…
      </span>
      <div aria-hidden="true">
        <Bone className="mb-1 h-7 w-40 rounded bg-edge/50" />
        <Bone className="mb-4 h-4 w-56 rounded bg-edge/30" />

        {/* Trending rail */}
        <div className="mb-6">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <Bone className="h-4 w-32 rounded bg-edge/50" />
            <Bone className="h-3 w-24 rounded bg-edge/30" />
          </div>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[212px] w-[172px] shrink-0 animate-soft-pulse rounded-2xl border-2 border-dashed border-ink/10 bg-paper"
              />
            ))}
          </div>
        </div>

        {/* Section header + diet filter */}
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-edge pb-2">
          <Bone className="h-4 w-24 rounded bg-edge/50" />
          <Bone className="h-8 w-40 rounded-xl bg-edge/30" />
        </div>

        <Bone className="mb-3 h-3 w-28 rounded bg-edge/40" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
