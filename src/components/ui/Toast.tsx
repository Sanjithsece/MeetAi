import { FaCircleCheck } from "react-icons/fa6";

export function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-md bg-ink px-4 py-3 text-sm font-medium text-white shadow-xl dark:bg-white dark:text-ink">
      <FaCircleCheck className="text-teal" />
      {message}
    </div>
  );
}
