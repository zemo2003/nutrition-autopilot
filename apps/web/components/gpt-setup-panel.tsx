"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("onrender.com")) {
      return `${window.location.protocol}//${host.replace("-web", "-api")}`;
    }
    return `${window.location.protocol}//${host}:4000`;
  }
  return "http://localhost:4000";
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <div className="copy-row">
      <code className="copy-value">{text}</code>
      <button className="btn btn-sm" onClick={handleCopy} title={`Copy ${label}`}>
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

const GPT_INSTRUCTIONS = `You are a meal planning assistant for Numen, a nutrition management system.

Your workflow:
1. First, call listClients to see who you're planning meals for
2. Call listMenuItems to see available menu items (SKUs)
3. Plan meals based on the user's preferences and dietary needs
4. Push the meal plan using pushMealPlan

When pushing meals:
- Use exact client names from the client list
- Use existing menu item names when possible (new items will be auto-created as placeholders)
- Always include serviceDate (YYYY-MM-DD), mealSlot (breakfast/lunch/dinner/snack), and servings
- You can add notes for special instructions (e.g., "extra veggies", "no sauce")

Supported meal slots: breakfast, lunch, dinner, snack, pre_training, post_training, pre_bed

Always confirm the plan with the user before pushing it.`;

export function GptSetupPanel() {
  const apiBase = resolveApiBase();
  const specUrl = `${apiBase}/v1/openapi.json`;

  return (
    <div className="page-shell">
      <div className="breadcrumbs">
        <Link href="/">Dashboard</Link>
        <span className="sep">/</span>
        <span className="current">GPT Setup</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">ChatGPT Custom GPT Setup</h1>
          <p className="page-subtitle">
            Connect ChatGPT to Numen so your GPT can push meal plans directly into the system.
          </p>
        </div>
        <div className="page-header-actions">
          <Link href="/" className="btn btn-outline">
            Back to Dashboard
          </Link>
        </div>
      </div>

      <div className="stack" style={{ gap: "var(--sp-6)" }}>
        {/* Step 1 — API Key */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Step 1: API Key</h2>
          </div>
          <div className="card-body">
            <p style={{ marginBottom: "var(--sp-3)", color: "var(--fg-muted)" }}>
              Set the <code>NUMEN_API_KEY</code> environment variable on your API server.
              This key authenticates your Custom GPT. Use any secure random string.
            </p>
            <p style={{ marginBottom: "var(--sp-3)", color: "var(--fg-muted)" }}>
              Example: generate one with <code>openssl rand -base64 32</code>
            </p>
            <p style={{ color: "var(--fg-muted)", fontSize: "var(--fs-sm)" }}>
              The API key is not displayed here for security. Set it as an environment variable on your server (e.g., Render dashboard &rarr; Environment).
            </p>
          </div>
        </div>

        {/* Step 2 — OpenAPI Spec URL */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Step 2: OpenAPI Spec URL</h2>
          </div>
          <div className="card-body">
            <p style={{ marginBottom: "var(--sp-3)", color: "var(--fg-muted)" }}>
              Use this URL when configuring your Custom GPT Action in ChatGPT:
            </p>
            <CopyButton text={specUrl} label="OpenAPI spec URL" />
          </div>
        </div>

        {/* Step 3 — Create the Custom GPT */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Step 3: Create Custom GPT in ChatGPT</h2>
          </div>
          <div className="card-body">
            <ol className="setup-steps">
              <li>
                Go to{" "}
                <a
                  href="https://chatgpt.com/gpts/editor"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  chatgpt.com/gpts/editor
                </a>
              </li>
              <li>Click <strong>Create a GPT</strong></li>
              <li>Give it a name like <strong>&ldquo;Numen Meal Planner&rdquo;</strong></li>
              <li>
                Paste the instructions below into the <strong>Instructions</strong> field
              </li>
              <li>
                Go to <strong>Configure &rarr; Actions &rarr; Create new action</strong>
              </li>
              <li>
                Click <strong>&ldquo;Import from URL&rdquo;</strong> and paste the OpenAPI spec URL from Step 2
              </li>
              <li>
                Under <strong>Authentication</strong>, choose <strong>API Key</strong>,
                auth type <strong>Bearer</strong>, and paste your <code>NUMEN_API_KEY</code>
              </li>
              <li>
                Set the <strong>Privacy policy URL</strong> to your site URL (e.g., your Render web app URL)
              </li>
              <li>Click <strong>Save</strong> &mdash; your GPT is ready!</li>
            </ol>
          </div>
        </div>

        {/* Step 4 — GPT Instructions */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Step 4: GPT Instructions</h2>
          </div>
          <div className="card-body">
            <p style={{ marginBottom: "var(--sp-3)", color: "var(--fg-muted)" }}>
              Copy and paste these instructions into your Custom GPT&apos;s Instructions field:
            </p>
            <div style={{ position: "relative" }}>
              <pre
                style={{
                  background: "var(--bg-sunken, #f5f5f5)",
                  padding: "var(--sp-4)",
                  borderRadius: "var(--radius)",
                  fontSize: "var(--fs-sm)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "300px",
                  overflow: "auto",
                  border: "1px solid var(--border)",
                }}
              >
                {GPT_INSTRUCTIONS}
              </pre>
              <div style={{ marginTop: "var(--sp-2)" }}>
                <CopyButton text={GPT_INSTRUCTIONS} label="GPT instructions" />
              </div>
            </div>
          </div>
        </div>

        {/* Test it */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Test the Connection</h2>
          </div>
          <div className="card-body">
            <p style={{ marginBottom: "var(--sp-3)", color: "var(--fg-muted)" }}>
              After setting up your GPT, try these commands:
            </p>
            <ul style={{ paddingLeft: "var(--sp-4)", color: "var(--fg-muted)" }}>
              <li style={{ marginBottom: "var(--sp-2)" }}>
                <strong>&ldquo;Show me the client list&rdquo;</strong> &mdash; verifies API connection
              </li>
              <li style={{ marginBottom: "var(--sp-2)" }}>
                <strong>&ldquo;What menu items are available?&rdquo;</strong> &mdash; lists your SKUs
              </li>
              <li style={{ marginBottom: "var(--sp-2)" }}>
                <strong>&ldquo;Plan meals for Alex for next week&rdquo;</strong> &mdash; creates a meal plan
              </li>
            </ul>
            <p style={{ marginTop: "var(--sp-4)", color: "var(--fg-muted)", fontSize: "var(--fs-sm)" }}>
              Meal plans pushed from ChatGPT will appear on your Kitchen &rarr; Today and Prep Plan pages.
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        .copy-row {
          display: flex;
          align-items: center;
          gap: var(--sp-2);
          padding: var(--sp-2) var(--sp-3);
          background: var(--bg-sunken, #f5f5f5);
          border-radius: var(--radius);
          border: 1px solid var(--border);
        }
        .copy-value {
          flex: 1;
          font-size: var(--fs-sm);
          word-break: break-all;
          color: var(--fg);
        }
        .setup-steps {
          padding-left: var(--sp-5);
          color: var(--fg-muted);
        }
        .setup-steps li {
          margin-bottom: var(--sp-3);
          line-height: 1.6;
        }
      `}</style>
    </div>
  );
}
