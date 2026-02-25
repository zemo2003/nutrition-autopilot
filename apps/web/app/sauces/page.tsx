import Link from "next/link";
import { SauceBoard } from "../../components/sauce-board";

export default function SaucesPage() {
  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">Sauces</span>
      </div>
      <h1 className="page-title">Sauce Library</h1>
      <p className="page-subtitle">Manage sauces, condiments, variants, and pairings</p>
      <SauceBoard />
    </div>
  );
}
