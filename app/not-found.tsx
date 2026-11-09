import Link from "next/link";
export default function NotFound() {
  return <div className="card mt-10 text-center"><h1 className="text-xl font-bold">Not found</h1><Link href="/" className="text-accent underline">Back to Today</Link></div>;
}
