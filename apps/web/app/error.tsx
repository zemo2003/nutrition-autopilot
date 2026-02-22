"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page-shell">
      <div className="card">
        <div className="state-box">
          <div className="state-icon">!</div>
          <div className="state-title">Something went wrong</div>
          <div className="state-desc">
            {error.message || "An unexpected error occurred. Please try again."}
          </div>
          <div className="row mt-4">
            <button onClick={reset} className="btn-primary">
              Try Again
            </button>
            <Link href="/" className="btn btn-outline">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
