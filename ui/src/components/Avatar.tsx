import { hue } from "@/lib/board";
import { cn } from "@/lib/utils";

/** A person's initial on a quiet colour, with an optional presence dot. */
export function Avatar({ name, size = 24, online, className }: { name: string; size?: number; online?: boolean; className?: string }) {
  const channel = name.startsWith("#");
  const letter = channel ? "#" : (name.replace(/^@/, "")[0] ?? "?").toUpperCase();
  const h = hue(name.toLowerCase());
  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <span
        className="inline-flex size-full items-center justify-center rounded-full font-medium"
        style={{
          background: channel ? "var(--accent)" : `hsl(${h} 45% 88%)`,
          color: channel ? "var(--muted-foreground)" : `hsl(${h} 40% 30%)`,
          fontSize: Math.round(size * 0.45),
        }}
      >
        {letter}
      </span>
      {online !== undefined ? (
        <span
          className={cn("absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-background", online ? "bg-online" : "bg-muted-foreground/40")}
          style={{ width: Math.max(8, size * 0.36), height: Math.max(8, size * 0.36) }}
        />
      ) : null}
    </span>
  );
}
