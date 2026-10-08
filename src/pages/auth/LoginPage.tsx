import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useNavigate } from "react-router-dom";
import { FaBrain } from "react-icons/fa6";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = async (values: FormValues) => {
    setError("");
    try {
      await login(values);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <main className="grid min-h-[calc(100vh-4rem)] place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-md bg-teal text-white">
            <FaBrain />
          </span>
          <div>
            <h1 className="text-xl font-bold text-ink dark:text-white">Login to MeetAI</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Sign in with your local workspace account</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <label className="block text-sm font-semibold">
            Email
            <input className="mt-2 h-11 w-full rounded-md border border-line px-3 outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950" {...register("email")} />
            {errors.email ? <span className="text-xs text-rose">{errors.email.message}</span> : null}
          </label>
          <label className="block text-sm font-semibold">
            Password
            <input type="password" className="mt-2 h-11 w-full rounded-md border border-line px-3 outline-none focus:border-teal dark:border-slate-700 dark:bg-slate-950" {...register("password")} />
            {errors.password ? <span className="text-xs text-rose">{errors.password.message}</span> : null}
          </label>
          {error ? <p className="rounded-md bg-rose/10 p-3 text-sm text-rose">{error}</p> : null}
          <Button className="w-full" disabled={isSubmitting}>{isSubmitting ? "Signing in..." : "Sign in"}</Button>
        </form>
        <div className="mt-5 text-right text-sm text-slate-500 dark:text-slate-400">
          <Link to="/register">Create account</Link>
        </div>
      </Card>
    </main>
  );
}
