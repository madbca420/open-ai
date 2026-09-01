import { createFileRoute } from "@tanstack/react-router";
import { TopHud } from "@/components/jarvis/TopHud";
import { LeftRail } from "@/components/jarvis/LeftRail";
import { CenterRoom } from "@/components/jarvis/CenterRoom";
import { RightRail } from "@/components/jarvis/RightRail";
import { CodeEditor, Terminal, BottomHud } from "@/components/jarvis/BottomRow";
import { useJarvis } from "@/components/jarvis/useJarvis";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JARVIS AI — Multi-Agent Command Center" },
      {
        name: "description",
        content:
          "A living cyberpunk command center where DeepSeek, GLM and GPT-OSS agents build software in real time — missions, live console, code editor and agent activity.",
      },
      { property: "og:title", content: "JARVIS AI — Multi-Agent Command Center" },
      {
        property: "og:description",
        content: "Watch three AI agents code, architect and review a full-stack build inside a pixel-art AI headquarters.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { agents } = useJarvis();

  return (
    <main className="grid-fine flex h-screen flex-col gap-2 overflow-hidden bg-background p-2">
      <TopHud />
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_300px] gap-2">
        <LeftRail agents={agents} />
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
          <CenterRoom agents={agents} />
          <div className="grid grid-cols-2 gap-2">
            <CodeEditor />
            <Terminal />
          </div>
        </div>
        <RightRail agents={agents} />
      </div>
      <BottomHud />
    </main>
  );
}
