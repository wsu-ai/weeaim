import { RequireSession } from "@/components/require-session";

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <RequireSession>{children}</RequireSession>;
}
