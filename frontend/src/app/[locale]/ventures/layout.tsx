import { RequireSession } from "@/components/require-session";

export default function VenturesLayout({ children }: { children: React.ReactNode }) {
  return <RequireSession>{children}</RequireSession>;
}
