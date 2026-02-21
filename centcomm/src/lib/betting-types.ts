/**
 * Betting types and constants — safe for client and server use.
 * No fs/path imports. Only types and pure data.
 */

// ── League types ────────────────────────────────────────────────────────

export type LeagueKey = "epl" | "bundesliga" | "laliga";

export const LEAGUE_LABELS: Record<LeagueKey, string> = {
  epl: "Premier League",
  bundesliga: "Bundesliga",
  laliga: "La Liga",
};

export const LEAGUE_FLAGS: Record<LeagueKey, string> = {
  epl: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  bundesliga: "🇩🇪",
  laliga: "🇪🇸",
};

// ── TypeScript interfaces ──────────────────────────────────────────────

export interface GoalsProbabilities {
  home_expected: number;
  away_expected: number;
  total_expected: number;
  over_0_5: number;
  over_1_5: number;
  over_2_5: number;
  over_3_5: number;
  over_4_5: number;
  btts_yes: number;
  btts_no: number;
  first_half_over_0_5: number;
}

export interface CardsProbabilities {
  total_expected: number;
  over_1_5: number;
  over_2_5: number;
  over_3_5: number;
  over_4_5: number;
  over_5_5: number;
}

export interface CornersProbabilities {
  total_expected: number;
  over_7_5: number;
  over_8_5: number;
  over_9_5: number;
  over_10_5: number;
  over_11_5: number;
}

export interface RefereeProfile {
  cards_per_match: number | null;
  tendency: string | null;
  matches_analyzed: number;
}

export interface FixtureProbability {
  match_id: number;
  home_team: string;
  away_team: string;
  match_date: string;
  kick_off: string;
  referee: string | null;
  referee_profile: RefereeProfile | null;
  goals: GoalsProbabilities;
  cards: CardsProbabilities;
  corners: CornersProbabilities;
}

export interface ValueBet {
  market: string;
  market_key: string;
  our_probability: number;
  implied_probability: number;
  edge_percent: number;
  decimal_odds: number;
  kelly_stake_pct: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  fixture?: string;
}

export interface AccumulatorLeg extends ValueBet {
  fixture: string;
}

export interface Accumulator {
  legs: AccumulatorLeg[];
  n_legs: number;
  combined_odds: number;
  combined_probability: number;
  implied_combined_probability: number;
  combined_edge_percent: number;
  average_leg_edge: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface ValueBetGroup {
  fixture_probs: FixtureProbability;
  value_bets: ValueBet[];
}

export interface Analysis {
  generated_at: string;
  league?: string;
  league_name?: string;
  days_ahead: number;
  bankroll: number;
  odds_source: string | null;
  fixture_count: number;
  fixtures: FixtureProbability[];
  value_bets: Record<string, ValueBetGroup>;
  value_bet_count: number;
  accumulators: Accumulator[];
  /** Set when odds were auto-fetched from The Odds API */
  odds_fetched_at?: string;
  /** API credits remaining after last fetch */
  odds_credits_remaining?: number;
}

export interface TeamStats {
  matches_played: number;
  goals_pg: number;
  goals_conceded_pg: number;
  xg_pg: number;
  xg_conceded_pg: number;
  shots_pg: number;
  shots_conceded_pg: number;
  possession_pg: number;
  yellow_cards_pg: number;
  red_cards_pg: number;
  fouls_committed_pg: number;
  corners_won_pg: number;
  corners_conceded_pg: number;
  btts_rate: number;
  clean_sheet_rate: number;
  failed_to_score_rate: number;
  matches_sampled: number;
}

export interface TeamStatsData {
  fetched_at: string;
  competition: string;
  season: string;
  teams: Record<string, TeamStats>;
}

export interface OddsFixture {
  home_team: string;
  away_team: string;
  match_date?: string;
  markets: Record<string, number>;
}

export interface OddsInput {
  source: string;
  fetched_at?: string;
  odds_format: string;
  fixtures: OddsFixture[];
  /** True when odds were fetched automatically */
  auto_fetched?: boolean;
  /** API credits remaining after fetch */
  credits_remaining?: number;
  /** Which bookmaker has the best price per market per fixture */
  bookmaker_per_market?: Record<string, Record<string, string>>;
}

// ── Market definitions (for odds input form) ───────────────────────────

export const MARKET_GROUPS = {
  goals: {
    label: "Goals",
    markets: [
      { key: "goals_over_0_5", label: "Over 0.5" },
      { key: "goals_under_0_5", label: "Under 0.5" },
      { key: "goals_over_1_5", label: "Over 1.5" },
      { key: "goals_under_1_5", label: "Under 1.5" },
      { key: "goals_over_2_5", label: "Over 2.5" },
      { key: "goals_under_2_5", label: "Under 2.5" },
      { key: "goals_over_3_5", label: "Over 3.5" },
      { key: "goals_under_3_5", label: "Under 3.5" },
      { key: "goals_over_4_5", label: "Over 4.5" },
      { key: "goals_under_4_5", label: "Under 4.5" },
      { key: "btts_yes", label: "BTTS Yes" },
      { key: "btts_no", label: "BTTS No" },
      { key: "first_half_over_0_5", label: "1H Over 0.5" },
      { key: "first_half_under_0_5", label: "1H Under 0.5" },
    ],
  },
  cards: {
    label: "Cards",
    markets: [
      { key: "cards_over_1_5", label: "Over 1.5" },
      { key: "cards_under_1_5", label: "Under 1.5" },
      { key: "cards_over_2_5", label: "Over 2.5" },
      { key: "cards_under_2_5", label: "Under 2.5" },
      { key: "cards_over_3_5", label: "Over 3.5" },
      { key: "cards_under_3_5", label: "Under 3.5" },
      { key: "cards_over_4_5", label: "Over 4.5" },
      { key: "cards_under_4_5", label: "Under 4.5" },
      { key: "cards_over_5_5", label: "Over 5.5" },
      { key: "cards_under_5_5", label: "Under 5.5" },
    ],
  },
  corners: {
    label: "Corners",
    markets: [
      { key: "corners_over_7_5", label: "Over 7.5" },
      { key: "corners_under_7_5", label: "Under 7.5" },
      { key: "corners_over_8_5", label: "Over 8.5" },
      { key: "corners_under_8_5", label: "Under 8.5" },
      { key: "corners_over_9_5", label: "Over 9.5" },
      { key: "corners_under_9_5", label: "Under 9.5" },
      { key: "corners_over_10_5", label: "Over 10.5" },
      { key: "corners_under_10_5", label: "Under 10.5" },
      { key: "corners_over_11_5", label: "Over 11.5" },
      { key: "corners_under_11_5", label: "Under 11.5" },
    ],
  },
} as const;

// ── Market filter types (for fixtures tab filtering) ─────────────────

export type MarketFilter = "all" | "goals" | "cards" | "corners" | "btts";

export const MARKET_FILTER_OPTIONS: {
  key: MarketFilter;
  label: string;
  /** market_key prefixes that belong to this filter */
  prefixes: string[];
}[] = [
  { key: "all", label: "All", prefixes: [] },
  { key: "goals", label: "Goals", prefixes: ["goals_over", "goals_under", "first_half"] },
  { key: "cards", label: "Cards", prefixes: ["cards_"] },
  { key: "corners", label: "Corners", prefixes: ["corners_"] },
  { key: "btts", label: "BTTS", prefixes: ["btts_"] },
];

/** Check if a market_key matches the given filter */
export function marketKeyMatchesFilter(
  marketKey: string,
  filter: MarketFilter
): boolean {
  if (filter === "all") return true;
  const option = MARKET_FILTER_OPTIONS.find((o) => o.key === filter);
  if (!option) return true;
  return option.prefixes.some((p) => marketKey.startsWith(p));
}
