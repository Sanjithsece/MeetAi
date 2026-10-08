import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import type { RegisterPayload } from "@/types/auth";

type RegisterForm = Omit<RegisterPayload, "role" | "department"> & { workspaceName?: string };

export function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<RegisterForm>({
    defaultValues: { workspaceName: "Personal Workspace" }
  });

  // Accounts are always created as regular users; roles are assigned by an admin, never self-selected.
  const onSubmit = async (values: RegisterForm) => {
    setError(null);
    try {
      await registerUser(values as RegisterPayload);
      navigate("/");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const field = "h-11 rounded-md border border-line px-3 dark:border-slate-700 dark:bg-slate-950";

  return (
    <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-10">
      <Card className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-ink dark:text-white">Register for MeetAI</h1>
        {error ? <p className="mt-4 rounded-md bg-rose/10 p-3 text-sm text-rose">{error}</p> : null}
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <input className={field} placeholder="Full name" {...register("name", { required: true })} />
          <input className={field} placeholder="Email" type="email" {...register("email", { required: true })} />
          <input className={field} placeholder="Password (min 8 characters)" type="password" {...register("password", { required: true, minLength: 8 })} />
          <input className={field} placeholder="Workspace" {...register("workspaceName")} />
          <Button className="sm:col-span-2" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create account"}</Button>
        </form>
      </Card>
    </main>
  );
}
