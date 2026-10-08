import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader } from "@/components/ui/Card";
import { useAnalytics } from "@/services/queries";

const PIE_COLORS = ["#0f766e", "#0369a1", "#b45309", "#4f46e5", "#be123c", "#64748b"];

export function AnalyticsPage() {
  const { data, isLoading, error } = useAnalytics();

  const statusData = Object.entries(data?.statusBreakdown ?? {}).map(([name, value]) => ({
    name: name.replace(/_/g, " ").toLowerCase(),
    value
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-teal">Local analytics</p>
        <h1 className="text-3xl font-bold text-ink dark:text-white">Analytics</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">Computed from the meetings stored in your local database.</p>
      </div>

      {error ? <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{error.message}</p> : null}
      {isLoading ? <Card>Loading analytics...</Card> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total meetings" value={data?.totalMeetings ?? 0} />
        <Metric label="Recorded meetings" value={data?.recordedMeetings ?? 0} />
        <Metric label="Recording hours" value={data?.totalRecordingHours ?? 0} />
        <Metric label="Meeting hours" value={data?.totalMeetingHours ?? 0} />
        <Metric label="Average duration" value={`${data?.averageMeetingDuration ?? 0}m`} />
        <Metric label="Pending tasks" value={data?.pendingTasks ?? 0} />
        <Metric label="Completed tasks" value={data?.completedTasks ?? 0} />
        <Metric label="Overdue tasks" value={data?.overdueTasks ?? 0} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
        <Card>
          <CardHeader title="Meetings per month" eyebrow="Last 6 months" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.byMonth ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="meetings" name="Meetings" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recorded" name="Recorded" fill="#0369a1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Status breakdown" eyebrow="All meetings" />
          <div className="h-72">
            {statusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {statusData.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-10 text-center text-sm text-slate-500">No meetings recorded yet.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink dark:text-white">{value}</p>
    </Card>
  );
}
