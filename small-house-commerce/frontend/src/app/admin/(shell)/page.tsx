import type { Metadata } from "next";
import { DashboardClient } from "@/components/admin/dashboard/DashboardClient";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * `/admin` — the operator workbench.
 *
 * The dashboard is client-rendered because every card follows one period
 * control and refreshes independently; the shell already provides auth and
 * navigation.
 */
export default function AdminDashboardPage() {
  return <DashboardClient />;
}
