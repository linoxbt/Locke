"use client";

// Last resort when the root layout itself fails: no app chrome or stylesheet can be assumed.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f4f4f1", color: "#0c0c0d" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "120px 24px" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Locke couldn&apos;t load.</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#6b6b70" }}>
            Something broke on our side. Your plans keep running on Strike and the risk worker keeps watching them.
          </p>
          {error.digest && <p style={{ fontSize: 12, color: "#74747a" }}>Reference {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 16, height: 44, padding: "0 20px", borderRadius: 999, border: 0, background: "#0c0c0d", color: "#fff", fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
