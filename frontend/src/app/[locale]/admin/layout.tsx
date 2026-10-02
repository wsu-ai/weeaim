import { RequireSession } from "@/components/require-session";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireSession>{children}</RequireSession>;
}
