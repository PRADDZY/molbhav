import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "./store";

function inr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function fairnessPercent(current: number, anchor: number): number {
  const floor = anchor * 0.6;
  const range = anchor - floor;
  if (range <= 0) return 50;
  const percent = ((current - floor) / range) * 100;
  return Math.max(0, Math.min(100, percent));
}

export default function App() {
  const {
    products,
    selectedProduct,
    isDrawerOpen,
    isLoading,
    error,
    sessionId,
    state,
    currentPrice,
    anchorPrice,
    round,
    maxRounds,
    tactic,
    rationale,
    chat,
    loadProducts,
    openNegotiation,
    closeNegotiation,
    submitOffer
  } = useAppStore();

  const [offer, setOffer] = useState("");
  const [message, setMessage] = useState("");
  const [showExitPrompt, setShowExitPrompt] = useState(false);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const fairness = useMemo(() => fairnessPercent(currentPrice, anchorPrice || 1), [currentPrice, anchorPrice]);
  const sessionLive = state !== "idle" && state !== "agreed" && state !== "broken" && state !== "timed_out";

  const onClose = () => {
    if (sessionLive) {
      setShowExitPrompt(true);
      return;
    }
    closeNegotiation();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const numeric = Number(offer);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return;
    }
    await submitOffer(numeric, message);
    setMessage("");
  };

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Outskill Hackathon MVP</p>
        <h1>MolBhav AI</h1>
        <p>Indian bazaar style negotiation engine with deterministic pricing + Hinglish dialogue.</p>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <main className="grid">
        {products.map((product) => (
          <article className="card" key={product.id}>
            <div className="card-top">
              <span className="chip">{product.category}</span>
              <strong>{inr(product.anchor_price)}</strong>
            </div>
            <h3>{product.name}</h3>
            <p>Target margin: {(product.target_margin * 100).toFixed(0)}%</p>
            <button type="button" onClick={() => void openNegotiation(product)}>
              Negotiate
            </button>
          </article>
        ))}
      </main>

      {isDrawerOpen && selectedProduct ? (
        <section className="drawer-backdrop">
          <aside className="drawer">
            <div className="drawer-head">
              <div>
                <h2>{selectedProduct.name}</h2>
                <p>Session: {sessionId.slice(0, 8)} • {round}/{maxRounds}</p>
              </div>
              <button className="ghost" type="button" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="fairness">
              <div className="fairness-labels">
                <span>{inr(anchorPrice * 0.6)}</span>
                <span>Fairness Meter</span>
                <span>{inr(anchorPrice)}</span>
              </div>
              <div className="bar">
                <div className="zone low" />
                <div className="zone warm" />
                <div className="zone fair" />
                <div className="zone high" />
                <span className="needle" style={{ left: `${fairness}%` }} />
              </div>
              <p>Current offer: {inr(currentPrice)}</p>
            </div>

            <div className="chat">
              {chat.map((line) => (
                <div key={line.id} className={`bubble ${line.from}`}>
                  <p>{line.text}</p>
                  {line.price ? <small>{inr(line.price)}</small> : null}
                </div>
              ))}
              {isLoading ? <p className="typing">Negotiating...</p> : null}
            </div>

            <div className="meta">
              <span>Tactic: {tactic || "-"}</span>
              <span>Why: {rationale || "-"}</span>
              <span>State: {state}</span>
            </div>

            {state === "agreed" ? (
              <div className="success">
                Deal Done. You saved {inr(Math.max(anchorPrice - currentPrice, 0))}.
              </div>
            ) : null}

            <form className="offer-form" onSubmit={submit}>
              <input
                value={offer}
                onChange={(event) => setOffer(event.target.value)}
                placeholder="Offer price (e.g. 950)"
                type="number"
                min="1"
                step="1"
                required
              />
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Optional message..."
              />
              <button type="submit" disabled={isLoading || state === "agreed" || state === "timed_out" || state === "broken"}>
                Send Offer
              </button>
            </form>
          </aside>
        </section>
      ) : null}

      {showExitPrompt ? (
        <section className="exit-prompt">
          <div className="exit-card">
            <h3>Wait! Last price {inr(currentPrice)}</h3>
            <p>Looks like you are walking away. Want one final shot at this rate?</p>
            <div className="row">
              <button
                type="button"
                onClick={() => {
                  setShowExitPrompt(false);
                  closeNegotiation();
                }}
              >
                Leave
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitPrompt(false);
                  void submitOffer(currentPrice, "Final kar do");
                }}
              >
                Take last price
              </button>
              <button type="button" onClick={() => setShowExitPrompt(false)}>
                Continue bargaining
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

