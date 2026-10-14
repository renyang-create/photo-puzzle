"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { DIFFICULTIES, DIFFICULTY_META, type Difficulty } from "@/lib/puzzle";

/**
 * 难度选择：3×3 / 4×4 / 5×5，默认沿用上次选择（localStorage: photoPuzzle.lastDifficulty）。
 */
export function DifficultyPicker({
  value,
  onChange,
  disabled,
}: {
  value: Difficulty;
  onChange: (difficulty: Difficulty) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="grid w-full grid-cols-3 gap-3"
      role="radiogroup"
      aria-label="选择难度"
    >
      {DIFFICULTIES.map((difficulty) => {
        const meta = DIFFICULTY_META[difficulty];
        const active = value === difficulty;
        return (
          <button
            key={difficulty}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(difficulty)}
            data-testid={`difficulty-${difficulty}`}
            className={cn(
              "relative flex flex-col items-center gap-1 rounded-xl border px-3 py-4 transition-colors",
              active
                ? "border-violet-400/70 bg-violet-500/15 text-violet-100"
                : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20",
              disabled && "opacity-60",
            )}
          >
            {active && (
              <motion.span
                layoutId="difficulty-glow"
                className="pointer-events-none absolute inset-0 rounded-xl shadow-[0_0_28px_-6px_rgba(167,139,250,0.8)]"
              />
            )}
            <span className="text-base font-semibold">{meta.label}</span>
            <span className="text-[11px]">{meta.sub}</span>
            {difficulty === 5 && <Sparkles className="size-3.5" />}
          </button>
        );
      })}
    </div>
  );
}
