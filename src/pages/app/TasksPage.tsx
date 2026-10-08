import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FaPlus, FaTrash } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PriorityBadge } from "@/components/meetings/StatusBadge";
import { useCreateTask, useDeleteTask, useTasks, useUpdateTask } from "@/services/queries";
import type { Priority, Task } from "@/types/meetai";
import { cn } from "@/utils/cn";

const control =
  "min-h-11 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950";

const FILTERS = ["ALL", "PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE"] as const;
type Filter = (typeof FILTERS)[number];

function isOverdue(task: Task) {
  return task.status !== "COMPLETED" && Boolean(task.deadline) && new Date(task.deadline as string) < new Date();
}

export function TasksPage() {
  const { data: tasks = [], isLoading, error } = useTasks();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const [filter, setFilter] = useState<Filter>("ALL");
  const [title, setTitle] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");

  const counts = useMemo(
    () => ({
      ALL: tasks.length,
      PENDING: tasks.filter((task) => task.status === "PENDING").length,
      IN_PROGRESS: tasks.filter((task) => task.status === "IN_PROGRESS").length,
      COMPLETED: tasks.filter((task) => task.status === "COMPLETED").length,
      OVERDUE: tasks.filter(isOverdue).length
    }),
    [tasks]
  );

  const visible = tasks.filter((task) => {
    if (filter === "ALL") return true;
    if (filter === "OVERDUE") return isOverdue(task);
    return task.status === filter;
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-teal">Action items</p>
        <h1 className="text-3xl font-bold text-ink dark:text-white">Tasks</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          Manual tasks and action items extracted from your meetings by the local model.
        </p>
      </div>

      {error ? <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{error.message}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE"] as const).map((key) => (
          <Card key={key} className="p-4">
            <p className="text-sm font-semibold text-slate-500">{key.replace("_", " ").toLowerCase()}</p>
            <p className="mt-1 text-3xl font-bold text-ink dark:text-white">{counts[key]}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Add a task" />
        <form
          className="grid gap-3 lg:grid-cols-[1fr_180px_170px_140px_110px]"
          onSubmit={(event) => {
            event.preventDefault();
            createTask.mutate(
              {
                title,
                assigneeName: assigneeName || undefined,
                deadline: deadline ? new Date(deadline).toISOString() : undefined,
                priority
              },
              {
                onSuccess: () => {
                  setTitle("");
                  setAssigneeName("");
                  setDeadline("");
                }
              }
            );
          }}
        >
          <input className={control} placeholder="Task title" required minLength={2} value={title} onChange={(event) => setTitle(event.target.value)} />
          <input className={control} placeholder="Owner" value={assigneeName} onChange={(event) => setAssigneeName(event.target.value)} />
          <input className={control} type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          <select className={control} value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={createTask.isPending}>
            <FaPlus /> Add
          </Button>
        </form>
        {createTask.error ? <p className="mt-3 rounded-md bg-rose/10 p-3 text-sm text-rose">{createTask.error.message}</p> : null}
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry}
            onClick={() => setFilter(entry)}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-semibold transition",
              filter === entry
                ? "bg-teal text-white"
                : "border border-line text-slate-600 hover:bg-mist dark:border-slate-700 dark:text-slate-300"
            )}
          >
            {entry.replace("_", " ").toLowerCase()} ({counts[entry]})
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-mist text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950">
              <tr>
                <th className="px-5 py-3">Task</th>
                <th className="px-5 py-3">Owner</th>
                <th className="px-5 py-3">Due</th>
                <th className="px-5 py-3">Priority</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td className="px-5 py-4" colSpan={6}>
                    Loading tasks...
                  </td>
                </tr>
              ) : null}
              {visible.map((task) => (
                <tr key={task.id} className={cn(isOverdue(task) && "bg-rose/5")}>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-ink dark:text-white">{task.title}</p>
                    <p className="text-xs text-slate-500">
                      {task.aiGenerated ? "From AI analysis" : "Manual"}
                      {task.meeting ? (
                        <>
                          {" · "}
                          <Link className="text-teal" to={`/meetings/${task.meeting}`}>
                            open meeting
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </td>
                  <td className="px-5 py-4">{task.assigneeName || "Unassigned"}</td>
                  <td className="px-5 py-4">
                    {task.deadline ? new Date(task.deadline).toLocaleDateString() : "-"}
                    {isOverdue(task) ? <span className="ml-2 text-xs font-bold text-rose">overdue</span> : null}
                  </td>
                  <td className="px-5 py-4">
                    <PriorityBadge priority={task.priority} />
                  </td>
                  <td className="px-5 py-4">
                    <select
                      className={`${control} min-h-9 py-0`}
                      value={task.status}
                      onChange={(event) => updateTask.mutate({ id: task.id, status: event.target.value as Task["status"] })}
                    >
                      <option value="PENDING">Pending</option>
                      <option value="IN_PROGRESS">In progress</option>
                      <option value="COMPLETED">Completed</option>
                    </select>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      className="h-9 w-9 p-0 text-rose"
                      aria-label="Delete task"
                      onClick={() => deleteTask.mutate(task.id)}
                    >
                      <FaTrash />
                    </Button>
                  </td>
                </tr>
              ))}
              {!isLoading && !visible.length ? (
                <tr>
                  <td className="px-5 py-8 text-center text-slate-500" colSpan={6}>
                    No tasks in this view.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
