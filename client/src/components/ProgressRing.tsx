import type { ReactNode } from "react";

type Props = {
  /** 0 to 1 — how filled the ring is */
  progress: number;
  /** Outer diameter in px */
  size?: number;
  /** Ring stroke thickness */
  strokeWidth?: number;
  children: ReactNode;
};

export function ProgressRing({ progress, size = 240, strokeWidth = 4, children }: Props) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  const center = size / 2;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="text-primary transition-all duration-700 ease-out"
        />
      </svg>
      <div
        className="absolute rounded-full overflow-hidden bg-muted"
        style={{
          top: strokeWidth * 2,
          left: strokeWidth * 2,
          right: strokeWidth * 2,
          bottom: strokeWidth * 2,
        }}
      >
        {children}
      </div>
    </div>
  );
}
