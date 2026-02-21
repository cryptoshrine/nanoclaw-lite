import { NextResponse } from "next/server";
import { getAllTeams, getTeamMembers, getTeamTasks } from "@/lib/db";
import { createTeam } from "@/lib/ipc";

export async function GET() {
  try {
    const teams = getAllTeams();
    // Enrich with members and tasks
    const enriched = teams.map((team) => ({
      ...team,
      members: getTeamMembers(team.id),
      tasks: getTeamTasks(team.id),
    }));
    return NextResponse.json({ teams: enriched });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch teams", detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 }
      );
    }

    const filePath = createTeam({ name });
    return NextResponse.json({ success: true, ipcFile: filePath });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create team", detail: String(error) },
      { status: 500 }
    );
  }
}
