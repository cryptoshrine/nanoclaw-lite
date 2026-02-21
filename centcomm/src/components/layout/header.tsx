"use client";

import { Activity, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

export function Header() {
  const [online, setOnline] = useState(true);
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);

    // Check API connectivity
    const checkOnline = async () => {
      try {
        const res = await fetch("/api/stats");
        setOnline(res.ok);
      } catch {
        setOnline(false);
      }
    };
    checkOnline();
    const healthInterval = setInterval(checkOnline, 30000);

    return () => {
      clearInterval(interval);
      clearInterval(healthInterval);
    };
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-medium text-muted-foreground tracking-widest uppercase">
          Command & Control Center
        </h1>
      </div>

      <div className="flex items-center gap-6">
        {/* System status */}
        <div className="flex items-center gap-2 text-sm">
          {online ? (
            <>
              <Wifi className="h-4 w-4 text-success" />
              <span className="text-success">ONLINE</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-alert" />
              <span className="text-alert">OFFLINE</span>
            </>
          )}
        </div>

        {/* Activity indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4" />
          <span className="font-mono">{time}</span>
        </div>
      </div>
    </header>
  );
}
