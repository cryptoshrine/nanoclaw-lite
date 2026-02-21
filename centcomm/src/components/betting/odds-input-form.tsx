"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronRight,
  Save,
  Trash2,
  Loader2,
  Zap,
} from "lucide-react";
import {
  MARKET_GROUPS,
  type FixtureProbability,
  type OddsInput,
  type OddsFixture,
} from "@/lib/betting-types";

interface OddsInputFormProps {
  fixtures: FixtureProbability[];
  onSaved?: () => void;
}

const SOURCES = ["Bet365", "Sky Bet", "William Hill", "Paddy Power", "Betfair", "Other"];
const STORAGE_KEY = "centcomm-odds-draft";

type OddsState = Record<string, Record<string, string>>;

export function OddsInputForm({ fixtures, onSaved }: OddsInputFormProps) {
  const [source, setSource] = useState("Bet365");
  const [oddsState, setOddsState] = useState<OddsState>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [autoOddsInfo, setAutoOddsInfo] = useState<{
    source?: string;
    fetched_at?: string;
    fixture_count?: number;
  } | null>(null);

  // Check if odds have been auto-fetched
  useEffect(() => {
    fetch("/api/betting/odds")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && data.auto_fetched) {
          setAutoOddsInfo({
            source: data.source,
            fetched_at: data.fetched_at,
            fixture_count: data.fixtures?.length,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Load draft from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.odds) setOddsState(parsed.odds);
        if (parsed.source) setSource(parsed.source);
      }
    } catch {
      // ignore
    }
  }, []);

  // Save draft to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ odds: oddsState, source })
      );
    } catch {
      // ignore
    }
  }, [oddsState, source]);

  const fixtureKey = (f: FixtureProbability) =>
    `${f.home_team} vs ${f.away_team}`;

  const setOdds = (fixture: string, market: string, value: string) => {
    setOddsState((prev) => ({
      ...prev,
      [fixture]: {
        ...(prev[fixture] || {}),
        [market]: value,
      },
    }));
  };

  const countFilledMarkets = (fixture: string) => {
    const markets = oddsState[fixture] || {};
    return Object.values(markets).filter(
      (v) => v && !isNaN(parseFloat(v)) && parseFloat(v) > 1
    ).length;
  };

  const totalFilledMarkets = Object.keys(oddsState).reduce(
    (sum, k) => sum + countFilledMarkets(k),
    0
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);

    try {
      const oddsFixtures: OddsFixture[] = [];

      for (const fixture of fixtures) {
        const key = fixtureKey(fixture);
        const markets = oddsState[key];
        if (!markets) continue;

        const validMarkets: Record<string, number> = {};
        for (const [mk, val] of Object.entries(markets)) {
          const num = parseFloat(val);
          if (!isNaN(num) && num > 1) {
            validMarkets[mk] = num;
          }
        }

        if (Object.keys(validMarkets).length > 0) {
          oddsFixtures.push({
            home_team: fixture.home_team,
            away_team: fixture.away_team,
            match_date: fixture.match_date,
            markets: validMarkets,
          });
        }
      }

      if (oddsFixtures.length === 0) {
        setSaveResult("No valid odds entered.");
        setSaving(false);
        return;
      }

      const payload: OddsInput = {
        source,
        odds_format: "decimal",
        fixtures: oddsFixtures,
      };

      const res = await fetch("/api/betting/odds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setSaveResult(
          `Saved ${data.fixture_count} fixtures. Run the analysis pipeline to detect value bets.`
        );
        onSaved?.();
      } else {
        const err = await res.json();
        setSaveResult(`Error: ${err.error}`);
      }
    } catch (error) {
      setSaveResult(`Error: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [fixtures, oddsState, source, onSaved]);

  const handleClear = () => {
    setOddsState({});
    localStorage.removeItem(STORAGE_KEY);
    setSaveResult(null);
  };

  const toggleFixture = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleGroup = (fixtureKey: string, groupKey: string) => {
    const k = `${fixtureKey}:${groupKey}`;
    setExpandedGroups((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  if (fixtures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No fixtures available for odds input.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Auto-fetch status banner */}
      {autoOddsInfo && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-electric/5 rounded-md px-3 py-2 border border-electric/10">
          <Zap className="h-3.5 w-3.5 text-electric shrink-0" />
          <div>
            <span className="text-foreground font-medium">Odds are auto-fetched</span>
            {" from "}
            <span className="text-foreground">{autoOddsInfo.source}</span>
            {autoOddsInfo.fetched_at && (
              <>
                {" | Last: "}
                <span className="text-foreground">
                  {new Date(autoOddsInfo.fetched_at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </>
            )}
            {autoOddsInfo.fixture_count && (
              <>
                {" | "}
                <span className="text-foreground">{autoOddsInfo.fixture_count} fixtures</span>
              </>
            )}
            <div className="mt-0.5 text-muted-foreground">
              Manual input below will override auto-fetched odds for specific markets.
            </div>
          </div>
        </div>
      )}

      {/* Source selector + actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Source:</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-border bg-card text-foreground"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {totalFilledMarkets > 0 && (
            <Badge variant="outline" className="text-xs">
              {totalFilledMarkets} odds entered
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleClear}
            className="h-7 text-xs"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || totalFilledMarkets === 0}
            className="h-7 text-xs"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            Save Odds
          </Button>
        </div>
      </div>

      {saveResult && (
        <div
          className={`text-xs px-3 py-2 rounded-md ${
            saveResult.startsWith("Error")
              ? "bg-alert/10 text-alert"
              : "bg-success/10 text-success"
          }`}
        >
          {saveResult}
        </div>
      )}

      {/* Per-fixture odds input */}
      {fixtures.map((fixture) => {
        const key = fixtureKey(fixture);
        const isExpanded = expanded[key] ?? false;
        const filled = countFilledMarkets(key);

        return (
          <Card key={fixture.match_id}>
            <CardHeader
              className="py-3 px-4 cursor-pointer"
              onClick={() => toggleFixture(key)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">
                    {fixture.home_team} vs {fixture.away_team}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {fixture.match_date}
                  </span>
                  {filled > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-electric/50 text-electric"
                    >
                      {filled}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="px-4 pb-4 pt-0 space-y-3">
                {Object.entries(MARKET_GROUPS).map(
                  ([groupKey, group]) => {
                    const gKey = `${key}:${groupKey}`;
                    const isGroupOpen = expandedGroups[gKey] ?? groupKey === "goals";

                    return (
                      <div key={groupKey}>
                        <button
                          onClick={() => toggleGroup(key, groupKey)}
                          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-1.5"
                        >
                          {isGroupOpen ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          {group.label}
                        </button>
                        {isGroupOpen && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {group.markets.map((market) => (
                              <div key={market.key} className="flex items-center gap-1.5">
                                <label className="text-[11px] text-muted-foreground w-16 shrink-0 truncate">
                                  {market.label}
                                </label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="1.01"
                                  placeholder="e.g. 1.85"
                                  value={oddsState[key]?.[market.key] ?? ""}
                                  onChange={(e) =>
                                    setOdds(key, market.key, e.target.value)
                                  }
                                  className="h-7 text-xs w-20 font-mono"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
