import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create account" };
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthForm mode="register" redirectTo={(await searchParams).next === "/invite" ? "/invite" : "/dashboard"} />;
}
