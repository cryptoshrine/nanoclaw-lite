import { AgentDetail } from "@/components/agents/agent-detail";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  const { folder } = await params;
  return <AgentDetail folder={folder} />;
}
