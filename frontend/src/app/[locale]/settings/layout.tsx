import { RequireSession } from "@/components/require-session";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <RequireSession>{children}</RequireSession>;
}
