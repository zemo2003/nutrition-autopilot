import ComposerBoard from "../../components/composer-board";

export default function ComposerPage() {
  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Menu Composer</h1>
          <p className="page-subtitle">
            Build composition-based meals from protein, base, vegetable, and sauce slots.
          </p>
        </div>
      </div>
      <ComposerBoard />
    </div>
  );
}
