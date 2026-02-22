import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-shell">
      <div className="card">
        <div className="state-box">
          <div className="state-icon">?</div>
          <div className="state-title">Page Not Found</div>
          <div className="state-desc">
            The page you are looking for does not exist or has been moved.
          </div>
          <Link href="/" className="btn btn-primary mt-4">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
