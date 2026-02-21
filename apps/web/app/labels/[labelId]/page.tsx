import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

async function getLabel(labelId: string) {
  const response = await fetch(`${API_BASE}/v1/labels/${labelId}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

async function getLineage(labelId: string) {
  const response = await fetch(`${API_BASE}/v1/labels/${labelId}/lineage`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

function Tree({ node }: { node: any }) {
  if (!node) return null;
  return (
    <li>
      <strong>{node.labelType}</strong> - {node.title}
      {node.children?.length ? (
        <ul>
          {node.children.map((child: any) => (
            <Tree key={child.labelId} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function LabelPage({ params }: { params: Promise<{ labelId: string }> }) {
  const { labelId } = await params;
  const [label, lineage] = await Promise.all([getLabel(labelId), getLineage(labelId)]);

  if (!label) {
    return (
      <main>
        <h1>Label Not Found</h1>
        <Link href="/">Back</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>{label.title}</h1>
      <p>
        Type: <code>{label.labelType}</code> | Version: <code>{label.version}</code>
      </p>

      <section className="card">
        <h3>Render Payload</h3>
        <pre>{JSON.stringify(label.renderPayload, null, 2)}</pre>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Lineage Tree</h3>
        {lineage ? <ul><Tree node={lineage} /></ul> : <p>No lineage edges.</p>}
      </section>
    </main>
  );
}
