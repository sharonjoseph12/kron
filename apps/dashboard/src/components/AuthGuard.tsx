import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { Spinner } from "./ui.js";

export default function AuthGuard() {
  const { data, isPending, isError } = useQuery({ queryKey: ["me"], queryFn: api.me });

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)]">
        <Spinner label="Checking session…" />
      </div>
    );
  }

  if (isError || !data?.user) return <Navigate to="/login" replace />;
  return <Outlet />;
}