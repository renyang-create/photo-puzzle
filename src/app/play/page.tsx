import type { Metadata } from "next";

import { GameShell } from "@/components/puzzle/game-shell";

export const metadata: Metadata = {
  title: "开始挑战",
};

export default function PlayPage() {
  return (
    <main className="flex flex-1 flex-col">
      <GameShell />
    </main>
  );
}
