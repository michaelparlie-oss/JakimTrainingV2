export interface Lap {
  distance: number; // m
  moving_time: number; // s
  elapsed_time: number; // s
  average_speed?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  start_index?: number;
  end_index?: number;
}

export interface Streams {
  time: number[];
  distance: number[];
  heartrate?: number[];
  velocity_smooth?: number[];
  moving?: boolean[];
}

export interface Act {
  id: number;
  local_date: string;
  start_date_local: string;
  sport_type: string;
  name?: string | null;
  description?: string | null;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s: number;
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed: number | null;
  laps: Lap[] | null;
  streams: Streams | null;
}

export const RUN_SPORTS = ["Run", "TrailRun", "VirtualRun"];
export const isRunActivity = (a: { sport_type: string }) => RUN_SPORTS.includes(a.sport_type);

export interface RepResult {
  segment_index: number;
  rep_no: number; // 1-based within the whole session
  zone: string;
  target_min: number | null;
  target_max: number | null;
  pace_s_per_km: number | null;
  avg_hr: number | null;
  hr_max: number | null;
  distance_m: number;
  duration_s: number;
  in_range: boolean | null;
  delta_s: number | null; // + slower than range, − faster than range, 0 inside
  hr_flag: boolean;
}

export interface RepDetection {
  method: "laps" | "streams" | "position" | "manual" | "none";
  reps: RepResult[];
}

export interface MatchStatus {
  plan_session_id: string;
  strava_activity_id: number | null;
  status: "done" | "partial" | "missed" | "moved" | "skipped" | "pending";
  manual: boolean;
}
