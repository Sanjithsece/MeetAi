import { Card } from "@/components/ui/Card";

type Column<T> = {
  key: keyof T | string;
  header: string;
  render?: (item: T) => React.ReactNode;
};

export function DataTable<T extends { id?: string; userId?: string }>({
  columns,
  data,
  empty = "No records found"
}: {
  columns: Column<T>[];
  data: T[];
  empty?: string;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            <tr>
              {columns.map((column) => (
                <th key={String(column.key)} className="px-5 py-3 font-semibold">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-slate-800">
            {data.length ? (
              data.map((item, index) => (
                <tr key={item.id ?? item.userId ?? index} className="bg-white dark:bg-slate-900">
                  {columns.map((column) => (
                    <td key={String(column.key)} className="px-5 py-4 text-slate-700 dark:text-slate-200">
                      {column.render ? column.render(item) : String(item[column.key as keyof T] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-5 py-8 text-center text-slate-500" colSpan={columns.length}>
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
