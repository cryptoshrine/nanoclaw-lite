"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamDetail } from "@/components/teams/team-detail";
import { CouncilMeeting } from "@/components/teams/council-meeting";
import { AgentChat } from "@/components/teams/agent-chat";
import {
  Users,
  MessageSquare,
  Megaphone,
  Bot,
  Clock,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";

interface TeamMember {
  id: string;
  name: string;
  model: string;
  role: string;
  status: string;
}

interface TeamTask {
  id: string;
  title: string;
  status: string;
}

interface Team {
  id: string;
  name: string;
  lead_group: string;
  status: string;
  created_at: string;
  members: TeamMember[];
  tasks: TeamTask[];
}

interface GroupInfo {
  name: string;
  folder: string;
  jid: string;
}

function timeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [teamsRes, groupsRes] = await Promise.all([
        fetch("/api/teams"),
        fetch("/api/groups"),
      ]);

      if (teamsRes.ok) {
        const data = await teamsRes.json();
        setTeams(data.teams || []);
      }
      if (groupsRes.ok) {
        const data = await groupsRes.json();
        setGroups(Array.isArray(data) ? data : data.groups || []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (selectedTeam) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Teams</h2>
          <p className="text-sm text-muted-foreground">
            Orchestrate multi-agent teams and council meetings
          </p>
        </div>
        <TeamDetail
          teamId={selectedTeam.id}
          teamName={selectedTeam.name}
          onBack={() => setSelectedTeam(null)}
        />
      </div>
    );
  }

  const activeTeams = teams.filter((t) => t.status === "active");
  const completedTeams = teams.filter((t) => t.status !== "active");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Teams</h2>
          <p className="text-sm text-muted-foreground">
            Orchestrate multi-agent teams and council meetings
          </p>
        </div>
        <button
          onClick={() => loadData()}
          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <Tabs defaultValue="teams" className="space-y-4">
        <TabsList className="bg-muted border border-border">
          <TabsTrigger
            value="teams"
            className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric"
          >
            <Users className="h-3.5 w-3.5" />
            Teams ({teams.length})
          </TabsTrigger>
          <TabsTrigger
            value="council"
            className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric"
          >
            <Megaphone className="h-3.5 w-3.5" />
            Council Meeting
          </TabsTrigger>
          <TabsTrigger
            value="chat"
            className="gap-1.5 data-[state=active]:bg-electric/10 data-[state=active]:text-electric"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Agent Chat
          </TabsTrigger>
        </TabsList>

        <TabsContent value="teams">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading teams...</p>
          ) : teams.length === 0 ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-12">
              <div className="text-center">
                <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">
                  No teams created yet
                </p>
                <p className="text-xs text-muted-foreground mt-1 opacity-60">
                  Teams are created from WhatsApp via agent commands
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {activeTeams.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Active Teams
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {activeTeams.map((team) => (
                      <button
                        key={team.id}
                        onClick={() =>
                          setSelectedTeam({ id: team.id, name: team.name })
                        }
                        className="text-left"
                      >
                        <Card className="border-border bg-card card-glow cursor-pointer transition-all hover:border-electric/30 border-l-2 border-l-success">
                          <CardContent className="p-5">
                            <div className="flex items-start justify-between">
                              <div>
                                <h4 className="font-semibold text-foreground">
                                  {team.name}
                                </h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 border-success/30 text-success"
                                  >
                                    active
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground">
                                    {timeAgo(team.created_at)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-3 gap-3">
                              <div className="flex items-center gap-1.5">
                                <Bot className="h-3.5 w-3.5 text-electric" />
                                <span className="text-sm text-muted-foreground">
                                  {team.members.length} members
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                <span className="text-sm text-muted-foreground">
                                  {
                                    team.tasks.filter(
                                      (t) => t.status === "completed"
                                    ).length
                                  }
                                  /{team.tasks.length} tasks
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-amber" />
                                <span className="text-sm text-muted-foreground">
                                  {team.lead_group}
                                </span>
                              </div>
                            </div>

                            {team.members.length > 0 && (
                              <div className="mt-3 flex items-center gap-1">
                                {team.members.slice(0, 5).map((m) => (
                                  <Badge
                                    key={m.id}
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 border-border"
                                  >
                                    {m.name}
                                  </Badge>
                                ))}
                                {team.members.length > 5 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    +{team.members.length - 5} more
                                  </span>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {completedTeams.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Completed Teams
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {completedTeams.map((team) => (
                      <button
                        key={team.id}
                        onClick={() =>
                          setSelectedTeam({ id: team.id, name: team.name })
                        }
                        className="text-left"
                      >
                        <Card className="border-border bg-card/50 cursor-pointer transition-all hover:border-electric/30">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-foreground">
                                {team.name}
                              </span>
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-border text-muted-foreground"
                              >
                                {team.status}
                              </Badge>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                              <span>{team.members.length} members</span>
                              <span>{team.tasks.length} tasks</span>
                              <span>{timeAgo(team.created_at)}</span>
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="council">
          <CouncilMeeting groups={groups} />
        </TabsContent>

        <TabsContent value="chat">
          <AgentChat groups={groups} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
