import { useEffect, useMemo, useRef, useState } from "react";
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

const GAUGE_START = -110;
const GAUGE_END = 110;

function gaugeAngle(percent: number): number {
  const safe = Math.max(0, Math.min(100, percent));
  return GAUGE_START + ((GAUGE_END - GAUGE_START) * safe) / 100;
}

function polarPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians)
  };
}

function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function fairnessBand(percent: number): { tone: "tight" | "value" | "fair" | "premium"; label: string } {
  if (percent < 25) return { tone: "tight", label: "Hard Bargain" };
  if (percent < 50) return { tone: "value", label: "Value Zone" };
  if (percent < 75) return { tone: "fair", label: "Balanced Deal" };
  return { tone: "premium", label: "Seller Friendly" };
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
  const [autoFollow, setAutoFollow] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

  const chatRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const previousChatCountRef = useRef(0);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const fairness = useMemo(() => fairnessPercent(currentPrice, anchorPrice || 1), [currentPrice, anchorPrice]);
  const band = useMemo(() => fairnessBand(fairness), [fairness]);
  const needleAngle = useMemo(() => gaugeAngle(fairness), [fairness]);
  const floorPrice = anchorPrice * 0.6;
  const savings = Math.max(anchorPrice - currentPrice, 0);
  const stateLabel = state.replace("_", " ");
  const sessionLive = state !== "idle" && state !== "agreed" && state !== "broken" && state !== "timed_out";

  const meterSegments = useMemo(
    () => [
      { start: 0, end: 25, tone: "tight" },
      { start: 25, end: 50, tone: "value" },
      { start: 50, end: 75, tone: "fair" },
      { start: 75, end: 100, tone: "premium" }
    ],
    []
  );

  const meterTicks = useMemo(
    () =>
      Array.from({ length: 11 }, (_, index) => {
        const percent = (index / 10) * 100;
        const angle = gaugeAngle(percent);
        return {
          id: index,
          major: index % 5 === 0,
          inner: polarPoint(120, 116, index % 5 === 0 ? 72 : 78, angle),
          outer: polarPoint(120, 116, 88, angle)
        };
      }),
    []
  );

  useEffect(() => {
    if (!isDrawerOpen) {
      setAutoFollow(true);
      setHasUnread(false);
      previousChatCountRef.current = 0;
      return;
    }
    previousChatCountRef.current = chat.length;
  }, [isDrawerOpen, chat.length]);

  useEffect(() => {
    const previousCount = previousChatCountRef.current;
    if (chat.length > previousCount && !autoFollow) {
      setHasUnread(true);
    }
    previousChatCountRef.current = chat.length;
  }, [autoFollow, chat.length]);

  useEffect(() => {
    if (!isDrawerOpen || !autoFollow) {
      return;
    }
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
    setHasUnread(false);
  }, [autoFollow, chat.length, isDrawerOpen, isLoading]);

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

  const onChatScroll = () => {
    if (!chatRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 36;
    setAutoFollow(nearBottom);
    if (nearBottom) {
      setHasUnread(false);
    }
  };

  const jumpToLatest = () => {
    setAutoFollow(true);
    setHasUnread(false);
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end", inline: "nearest" });
  };

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Outskill Hackathon MVP</p>
        <h1>MolBhav AI</h1>
        <p>Indian bazaar style negotiation engine with deterministic pricing, fair tactics, and Hinglish dialogue.</p>
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
                <p>Session: {sessionId.slice(0, 8)} - Round {round}/{maxRounds}</p>
              </div>
              <span className={`state-pill ${state}`}>{stateLabel}</span>
              <button className="ghost" type="button" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="negotiation-layout">
              <section className="instrument-panel">
                <div className="meter-card">
                  <div className="meter-head">
                    <p>Fairness Meter</p>
                    <span className={`meter-band ${band.tone}`}>{band.label}</span>
                  </div>

                  <svg className="meter-svg" viewBox="0 0 240 160" role="img" aria-label={`Fairness ${fairness.toFixed(0)} percent`}>
                    <path className="meter-track" d={arcPath(120, 116, 82, GAUGE_START, GAUGE_END)} />
                    {meterSegments.map((segment) => (
                      <path
                        key={`${segment.tone}-${segment.start}`}
                        className={`meter-segment ${segment.tone}`}
                        d={arcPath(120, 116, 82, gaugeAngle(segment.start), gaugeAngle(segment.end))}
                      />
                    ))}
                    {meterTicks.map((tick) => (
                      <line
                        key={tick.id}
                        className={`meter-tick ${tick.major ? "major" : "minor"}`}
                        x1={tick.inner.x}
                        y1={tick.inner.y}
                        x2={tick.outer.x}
                        y2={tick.outer.y}
                      />
                    ))}
                    <line
                      className="meter-needle"
                      x1={120}
                      y1={116}
                      x2={120}
                      y2={52}
                      style={{ transform: `rotate(${needleAngle}deg)` }}
                    />
                    <circle className="meter-hub" cx={120} cy={116} r={8} />
                  </svg>

                  <div className="meter-readout">
                    <strong>{fairness.toFixed(0)}%</strong>
                    <span>Current offer: {inr(currentPrice)}</span>
                  </div>

                  <div className="meter-scale">
                    <span>{inr(floorPrice)}</span>
                    <span>{inr(anchorPrice)}</span>
                  </div>
                </div>

                <div className="kpi-grid">
                  <article>
                    <p>Current</p>
                    <strong>{inr(currentPrice)}</strong>
                  </article>
                  <article>
                    <p>Savings</p>
                    <strong>{inr(savings)}</strong>
                  </article>
                  <article>
                    <p>Turns Left</p>
                    <strong>{Math.max(maxRounds - round, 0)}</strong>
                  </article>
                </div>
              </section>

              <section className="conversation-panel">
                <div className="chat-shell">
                  <div className="chat" ref={chatRef} onScroll={onChatScroll}>
                    {chat.map((line) => (
                      <div key={line.id} className={`bubble ${line.from}`}>
                        <p>{line.text}</p>
                        {line.price ? <small>{inr(line.price)}</small> : null}
                      </div>
                    ))}
                    {isLoading ? (
                      <div className="bubble seller typing-bubble" aria-live="polite" aria-label="Negotiating">
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : null}
                    <div ref={chatEndRef} />
                  </div>
                  {hasUnread ? (
                    <button type="button" className="jump-latest" onClick={jumpToLatest}>
                      New replies
                    </button>
                  ) : null}
                </div>

                <div className="meta">
                  <span>Tactic: {tactic || "-"}</span>
                  <span>Why: {rationale || "-"}</span>
                  <span>State: {stateLabel}</span>
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
              </section>
            </div>
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
