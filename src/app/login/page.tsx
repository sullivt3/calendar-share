import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Log in" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthForm mode="login" redirectTo={(await searchParams).next === "/invite" ? "/invite" : "/dashboard"} />;
}
