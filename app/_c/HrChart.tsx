"use client";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function HrChart({ data, band, bandLabel }: { data: { min: number; hr: number; pace: number | null }[]; band: [number | null, number | null]; bandLabel: string }) {
  const lo = band[0] ?? 0, hi = band[1];
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="min" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${Math.round(v)}′`} fontSize={11} />
          <YAxis domain={[100, 200]} fontSize={11} />
          {hi != null && <ReferenceArea y1={lo || 100} y2={hi} fill="#10b981" fillOpacity={0.12} label={{ value: bandLabel, position: "insideTopLeft", fontSize: 10, fill: "#047857" }} />}
          <Tooltip formatter={(v, n) => (n === "hr" ? [`${v} bpm`, "Heart rate"] : [v, n])} labelFormatter={(l) => `${Math.round(Number(l))} min`} />
          <Area dataKey="hr" stroke="#e11d48" fill="#fecdd3" fillOpacity={0.3} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="hr" stroke="#e11d48" dot={false} strokeWidth={0} isAnimationActive={false} legendType="none" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
