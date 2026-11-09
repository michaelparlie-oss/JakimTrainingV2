import { LoginForm } from "./LoginForm";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="text-center text-3xl font-extrabold">JAKIM 2027</h1>
      <p className="mb-6 text-center text-sm text-muted">Mike&apos;s marathon tracker</p>
      <LoginForm next={next ?? "/"} />
    </div>
  );
}
