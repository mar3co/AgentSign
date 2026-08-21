import { cn } from "@/lib/utils";

export function ByteRange({
  sealed = false,
  className,
}: {
  sealed?: boolean;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={sealed ? "Sealed ByteRange" : "Unsigned ByteRange"}
      className={cn("px-4", className)}
    >
      <svg
        viewBox="0 0 100 8"
        className="h-2 w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect x="0" y="2.5" width="100" height="3" className="fill-border" />
        <rect x="0" y="2.5" width="62" height="3" className="fill-primary" />
        <rect x="78" y="2.5" width="22" height="3" className="fill-primary" />
        {sealed ? (
          <rect x="62" y="2.5" width="16" height="3" className="fill-seal" />
        ) : (
          <>
            <rect x="61.5" y="1" width="1" height="6" className="fill-seal" />
            <rect x="77.5" y="1" width="1" height="6" className="fill-seal" />
          </>
        )}
      </svg>
    </div>
  );
}
