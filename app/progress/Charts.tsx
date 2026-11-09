"use client";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

const box = "h-60 w-full";
const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function WeeklyKm({ data }: { data: { week: string; planned: number; actual: number | null }[] }) {
  return (
    <div className={box}><ResponsiveContainer>
      <ComposedChart data={data} margin={{ left: -20, right: 4 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="week" fontSize={10} interval={2} />
        <YAxis fontSize={11} unit="" />
        <Tooltip formatter={(v) => `${v} km`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="actual" name="Actual km" fill="#0f766e" radius={[3, 3, 0, 0]} />
        <Line dataKey="planned" name="Planned km" stroke="#6366f1" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer></div>
  );
}

export function LongRuns({ data }: { data: { week: string; planned: number | null; actual: number | null; cap: number | null }[] }) {
  return (
    <div className={box}><ResponsiveContainer>
      <LineChart data={data} margin={{ left: -20, right: 4 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="week" fontSize={10} interval={2} />
        <YAxis fontSize={11} />
        <Tooltip formatter={(v) => `${v} km`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="planned" name="Planned long run" stroke="#94a3b8" strokeDasharray="4 3" dot={false} connectNulls />
        <Line dataKey="actual" name="Your longest run" stroke="#0f766e" strokeWidth={2} connectNulls />
        <Line dataKey="cap" name="30-day max + 10%" stroke="#f59e0b" dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer></div>
  );
}

export function Efficiency({ data }: { data: { week: string; pace: number; n: number }[] }) {
  return (
    <div className={box}><ResponsiveContainer>
      <LineChart data={data} margin={{ left: -6, right: 4 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="week" fontSize={10} />
        <YAxis fontSize={11} domain={["dataMin - 15", "dataMax + 15"]} tickFormatter={pace} reversed />
        <Tooltip formatter={(v) => [`${pace(Number(v))} /km`, "Avg pace at HR 145–155"]} />
        <Line dataKey="pace" stroke="#0f766e" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer></div>
  );
}

export function Strength({ data }: { data: Record<string, number | string>[] }) {
  const cols: [string, string, string][] = [["back_squat", "Back squat", "#0f766e"], ["trap_bar_dl", "Trap-bar deadlift", "#6366f1"], ["rdl", "RDL", "#f59e0b"]];
  return (
    <div className={box}><ResponsiveContainer>
      <LineChart data={data} margin={{ left: -20, right: 4 }}>
        <CartesianGrid stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="date" fontSize={10} tickFormatter={(d) => String(d).slice(5)} />
        <YAxis fontSize={11} />
        <Tooltip formatter={(v) => `${v} kg`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {cols.map(([k, n, c]) => <Line key={k} dataKey={k} name={n} stroke={c} strokeWidth={2} connectNulls />)}
      </LineChart>
    </ResponsiveContainer></div>
  );
}

export function Knee({ data }: { data: { x: number; knee: number; long: boolean; date: string }[] }) {
  return (
    <div className={box}><ResponsiveContainer>
      <ScatterChart margin={{ left: -20, right: 4 }}>
        <CartesianGrid stroke="#e2e8f0" />
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} fontSize={10} tickFormatter={(x) => new Date(x).toISOString().slice(5, 10)} />
        <YAxis dataKey="knee" domain={[0, 10]} fontSize={11} />
        <ZAxis range={[60, 60]} />
        <ReferenceLine y={3} stroke="#e11d48" strokeDasharray="4 3" label={{ value: "3/10 limit", fontSize: 10, fill: "#e11d48", position: "insideTopRight" }} />
        <Tooltip formatter={(v, n) => (n === "x" ? new Date(Number(v)).toISOString().slice(0, 10) : v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Scatter name="Other days" data={data.filter((d) => !d.long)} fill="#64748b" />
        <Scatter name="Long-run days" data={data.filter((d) => d.long)} fill="#e11d48" shape="diamond" />
      </ScatterChart>
    </ResponsiveContainer></div>
  );
}
