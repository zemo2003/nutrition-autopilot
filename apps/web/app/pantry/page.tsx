"use client";

import { useState } from "react";
import { InventoryBoard } from "../../components/inventory-board";
import { SauceBoard } from "../../components/sauce-board";
import SauceMatrixBoard from "../../components/sauce-matrix-board";
import { SubstitutionBoard } from "../../components/substitution-board";

type Tab = "inventory" | "sauces" | "pairings" | "substitutions";

export default function PantryPage() {
  const [tab, setTab] = useState<Tab>("inventory");

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pantry</h1>
          <p className="page-subtitle">Inventory, sauces, flavor pairings, and ingredient swaps.</p>
        </div>
      </div>

      <div className="pill-bar">
        <button className={`pill ${tab === "inventory" ? "active" : ""}`} onClick={() => setTab("inventory")}>
          Inventory
        </button>
        <button className={`pill ${tab === "sauces" ? "active" : ""}`} onClick={() => setTab("sauces")}>
          Sauces
        </button>
        <button className={`pill ${tab === "pairings" ? "active" : ""}`} onClick={() => setTab("pairings")}>
          Pairings
        </button>
        <button className={`pill ${tab === "substitutions" ? "active" : ""}`} onClick={() => setTab("substitutions")}>
          Substitutions
        </button>
      </div>

      <div className="mt-6">
        {tab === "inventory" && <InventoryBoard />}
        {tab === "sauces" && <SauceBoard />}
        {tab === "pairings" && <SauceMatrixBoard />}
        {tab === "substitutions" && <SubstitutionBoard />}
      </div>
    </div>
  );
}
