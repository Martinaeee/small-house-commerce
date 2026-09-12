import type { Metadata } from "next";
import { AdminAuthProvider } from "@/components/admin/AdminAuthProvider";

export const metadata: Metadata = {
  title: { default: "Admin — Small House PH", template: "%s | Small House Admin" },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-background text-ink">
      <AdminAuthProvider>{children}</AdminAuthProvider>
    </div>
  );
}
