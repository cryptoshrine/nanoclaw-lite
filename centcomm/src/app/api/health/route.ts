import { NextResponse } from "next/server";
import os from "os";
import fs from "fs";
import { PATHS } from "@/lib/paths";

export const dynamic = "force-dynamic";

function getCpuUsage(): { model: string; speed: number; usage: number }[] {
  const cpus = os.cpus();
  return cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    const idle = cpu.times.idle;
    const usage = Math.round(((total - idle) / total) * 100);
    return {
      model: cpu.model,
      speed: cpu.speed,
      usage,
    };
  });
}

function getDiskUsage(): { total: number; free: number; used: number; usedPercent: number } | null {
  try {
    // Get disk stats for the project root drive
    const stats = fs.statfsSync(PATHS.root);
    const total = stats.bsize * stats.blocks;
    const free = stats.bsize * stats.bavail;
    const used = total - free;
    return {
      total,
      free,
      used,
      usedPercent: Math.round((used / total) * 100),
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const cpus = getCpuUsage();
    const avgCpuUsage = Math.round(cpus.reduce((sum, c) => sum + c.usage, 0) / cpus.length);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const disk = getDiskUsage();

    const health = {
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model || "Unknown",
        avgUsage: avgCpuUsage,
        perCore: cpus.map((c) => c.usage),
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usedPercent: Math.round((usedMem / totalMem) * 100),
      },
      disk: disk
        ? {
            total: disk.total,
            free: disk.free,
            used: disk.used,
            usedPercent: disk.usedPercent,
          }
        : null,
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        nodeVersion: process.version,
      },
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(health);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch health data", detail: String(error) },
      { status: 500 }
    );
  }
}
