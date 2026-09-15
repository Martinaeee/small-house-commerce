import type { Metadata } from "next";
import { AdminAuthProvider } from "@/components/admin/AdminAuthProvider";

// `absolute` bypasses the ROOT layout template ("%s | LUWAG Living"),
// which would otherwise double-suffix admin tabs; child pages export no
// titles, so every admin tab reads exactly "Admin — LUWAG Living".
export const metadata: Metadata = {
  title: {
    absolute: "Admin — LUWAG Living",
    template: "%s | LUWAG Admin",
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-background text-ink">
      <AdminAuthProvider>{children}</AdminAuthProvider>
    </div>
  );
}
