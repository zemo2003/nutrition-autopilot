"use client";

import { useEffect, useState } from "react";
import { ProgressReport } from "../../../../components/progress-report";

export default function ProgressReportPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const [clientId, setClientId] = useState<string>("");

  useEffect(() => {
    params.then((p) => setClientId(p.clientId));
  }, [params]);

  if (!clientId) return <div style={{ padding: 32, textAlign: "center", color: "#888" }}>Loading...</div>;

  return <ProgressReport clientId={clientId} />;
}
