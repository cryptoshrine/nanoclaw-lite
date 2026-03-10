/**
 * Backtest result types — safe for client and server use.
 * No fs/path imports. Only types and pure data.
 */

export interface BacktestMetadata {
  league: string;
  league_name: string;
  season: string;
  competition_id: number;
  season_id: number;
  run_at: string;
  total_season_matches: number;
  matches_predicted: number;
  matches_skipped_insufficient_data: number;
  min_matches_required: number;
  events_loaded: boolean;
  calibration_method: string;
  odds_source: string;
  real_odds_matched: number | null;
  real_odds_missed: number | null;
  margin_fair: number;
  margin_sharp: number;
  min_edge: number;
}

export interface BacktestAccuracy {
  "1x2_correct": number;
  "1x2_total": number;
  "1x2_accuracy": number;
}

export interface ScoringMetric {
  brier: number;
  log_loss: number;
}

export interface BacktestScoring {
  "1x2": ScoringMetric;
  over_2_5: ScoringMetric;
  btts: ScoringMetric;
  all_markets: ScoringMetric;
}

export interface CalibrationBucket {
  bucket: string;
  count: number;
  predicted_avg: number;
  actual_rate: number;
  gap: number;
}

export interface MarketAccuracyEntry {
  total: number;
  correct: number;
  hit_rate: number;
  brier: number;
  log_loss: number;
}

export interface PnlStrategy {
  starting_bankroll: number;
  final_bankroll: number;
  total_staked: number;
  total_profit: number;
  roi_pct: number;
  yield_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  bet_count: number;
  win_count: number;
  hit_rate_pct: number;
  monthly_pnl: Record<string, number>;
}

export interface MatchPredictionOutcome {
  predicted_prob: number;
  won: boolean;
  actual: string;
}

export interface MatchPrediction {
  match_id: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  home_lambda: number;
  away_lambda: number;
  predicted_1x2: string;
  actual_1x2: string;
  correct_1x2: boolean;
  outcomes: Record<string, MatchPredictionOutcome>;
}

export interface MatchdayResult {
  date: string;
  matches: number;
  correct_1x2: number;
  accuracy_1x2: number;
  predictions: MatchPrediction[];
}

export interface BacktestResult {
  metadata: BacktestMetadata;
  accuracy: BacktestAccuracy;
  scoring: BacktestScoring;
  calibration_raw: CalibrationBucket[];
  calibration_calibrated: CalibrationBucket[];
  calibration_1x2_calibrated: CalibrationBucket[];
  calibrator_status: Record<string, { samples: number; model_fitted: boolean }>;
  market_accuracy: Record<string, MarketAccuracyEntry>;
  pnl: Record<string, PnlStrategy>;
  matchday_results: MatchdayResult[];
}

/** Strategy display names */
export const STRATEGY_LABELS: Record<string, string> = {
  fair_odds_flat: "Fair Odds (Flat)",
  fair_odds_kelly: "Fair Odds (Kelly)",
  sharp_odds_flat: "Sharp Odds (Flat)",
  sharp_odds_kelly: "Sharp Odds (Kelly)",
};

/** Strategy colors */
export const STRATEGY_COLORS: Record<string, string> = {
  fair_odds_flat: "#3b82f6",
  fair_odds_kelly: "#06b6d4",
  sharp_odds_flat: "#22c55e",
  sharp_odds_kelly: "#f59e0b",
  flat: "#3b82f6",
  kelly: "#f59e0b",
};

// ─── OoS Backtest Types ───

export interface OosMetadata {
  type: "out_of_sample";
  league: string;
  train_season: string;
  test_season: string;
  train_matches: number;
  test_matches: number;
  predicted: number;
  skipped: number;
  odds_source: string;
  odds_matched: number;
  odds_missed: number;
  calibration: string;
  min_edge: number;
  min_matches: number;
  events: boolean;
  run_at: string;
}

export interface MarketPnlEntry {
  bets: number;
  win_rate: number;
  roi_pct: number;
  profit: number;
  avg_odds: number;
  avg_edge: number;
}

export interface OosBet {
  match_id: number;
  match_date: string;
  month: string;
  fixture: string;
  market_key: string;
  predicted_prob: number;
  raw_prob: number;
  decimal_odds: number;
  implied_prob: number;
  edge_pct: number;
  won: boolean;
  actual: string;
}

export interface OosBacktestResult {
  metadata: OosMetadata;
  accuracy: BacktestAccuracy;
  scoring: { "1x2": ScoringMetric; over_2_5: ScoringMetric; btts: ScoringMetric; all: ScoringMetric };
  calibration: CalibrationBucket[];
  pnl: Record<string, PnlStrategy>;
  market_pnl: Record<string, MarketPnlEntry>;
  bets: OosBet[];
}

// ─── Grid Search Types ───

export interface GridSearchParams {
  lambda_boost: number;
  rho: number;
  home_advantage: number;
  min_edge: number;
  regression_weight: number;
}

export interface GridSearchComboResult {
  combo_idx: number;
  params: GridSearchParams;
  bet_count: number;
  win_count: number;
  hit_rate: number;
  roi_pct: number;
  profit: number;
  market_breakdown: Record<string, { bets: number; wins: number; roi_pct: number; profit: number }>;
}

export interface GridSearchSummary {
  total_combos: number;
  profitable_combos: number;
  mean_roi: number;
  median_roi: number;
  best_roi: number;
  worst_roi: number;
  results: GridSearchComboResult[];
}

// ─── Backtest List Types ───

export interface BacktestListEntry {
  league: string;
  season: string;
  filename: string;
  size_kb: number;
  modified: string;
  type: "in_sample" | "out_of_sample";
  label: string;
}

// ─── League Config ───

export type LeagueKey = "epl" | "bundesliga" | "laliga";

export const LEAGUE_CONFIG: Record<LeagueKey, { name: string; flag: string }> = {
  epl: { name: "Premier League", flag: "🏴" },
  bundesliga: { name: "Bundesliga", flag: "🇩🇪" },
  laliga: { name: "La Liga", flag: "🇪🇸" },
};

// ─── Market Categories ───

export const MARKET_CATEGORIES: Record<string, string[]> = {
  "1X2": ["home_win", "draw", "away_win"],
  "Goals O/U": ["goals_over_0_5", "goals_over_1_5", "goals_over_2_5", "goals_over_3_5", "goals_over_4_5", "goals_under_0_5", "goals_under_1_5", "goals_under_2_5", "goals_under_3_5", "goals_under_4_5"],
  "BTTS": ["btts_yes", "btts_no"],
  "Double Chance": ["home_or_draw", "away_or_draw"],
  "Asian Handicap": ["ah_minus_0_5_home", "ah_minus_1_5_home"],
  "Correct Score": ["top_correct_score"],
};
