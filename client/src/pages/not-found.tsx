import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center text-center px-6">
      <div className="space-y-4">
        <h1 className="text-5xl">Not found</h1>
        <p className="text-muted-foreground">The page you're looking for isn't here.</p>
        <Link href="/" className="inline-block text-primary underline">
          Back home
        </Link>
      </div>
    </div>
  );
}
