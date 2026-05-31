type NegotiationState = "idle" | "proposing" | "responding" | "agreed" | "broken" | "timed_out";
type Actor = "buyer" | "seller";

interface Offer {
  round: number;
  actor: Actor;
  price: number;
  message: string;
  concession_delta: number;
  timestamp: string;
}

interface Product {
  id: string;
  name: string;
  category: string;
  anchor_price: number;
  cost_price: number;
  min_margin: number;
  target_margin: number;
  metadata: Record<string, unknown>;
  reservation_price: number;
  target_price: number;
}

interface SessionRecord {
  session_id: string;
  session_token: string;
  product_id: string;
  product_name: string;
  anchor_price: number;
  reservation_price: number;
  beta: number;
  alpha: number;
  max_rounds: number;
  current_round: number;
  ttl_seconds: number;
  state: NegotiationState;
  current_seller_price: number;
  agreed_price: number | null;
  bot_score: number;
  buyer_ip: string;
  offer_history: Offer[];
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface NegotiationResponse {
  session_id: string;
  session_token: string;
  message: string;
  current_price: number;
  anchor_price: number;
  state: NegotiationState;
  tactic: string;
  sentiment: string;
  rationale: string;
  round: number;
  max_rounds: number;
  quote_ttl_seconds: number;
  agreed_price: number | null;
  metadata: Record<string, unknown>;
}

const SESSION_ID_RE = /^[a-f0-9]{32}$/;
const PRODUCT_ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const INJECTION_PATTERN = /(ignore\s+previous|system\s*:|you\s+are\s+now|disregard\s+instructions)/i;
const DIALOGUE_SENTIMENTS = new Set(["friendly", "firm", "celebratory", "urgent"]);
const DIALOGUE_RESPONSE_SCHEMA = {
  name: "negotiation_dialogue",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      message: { type: "string" },
      sentiment: { type: "string", enum: ["friendly", "firm", "celebratory", "urgent"] },
      rationale: { type: "string" },
    },
    required: ["message", "sentiment", "rationale"],
  },
} as const;
type LlmProvider = "groq" | "openrouter" | "rule-fallback";
type UpstreamLlmProvider = Exclude<LlmProvider, "rule-fallback">;

interface DialogueResult {
  message: string;
  sentiment: string;
  rationale: string;
  timed_out: boolean;
  model: string;
  provider: LlmProvider;
}

const EXIT_TERMS = [
  "too expensive",
  "too costly",
  "no deal",
  "bye",
  "forget it",
  "bohot mehenga",
  "bahut mehenga",
  "chhodo",
  "nahi chahiye",
  "jaane do",
];

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

class LlmProviderError extends Error {
  constructor(
    public provider: UpstreamLlmProvider,
    message: string,
    public status?: number,
    public bodyPreview?: string,
    public returnedModel?: string,
  ) {
    super(message);
  }
}

export class SessionLockDurableObject {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/acquire" && request.method === "POST") {
      const now = Date.now();
      const lockedUntil = (await this.state.storage.get<number>("lockedUntil")) ?? 0;
      if (lockedUntil > now) {
        return new Response("locked", { status: 409 });
      }
      await this.state.storage.put("lockedUntil", now + 5000);
      return new Response("ok");
    }

    if (path === "/release" && request.method === "POST") {
      await this.state.storage.put("lockedUntil", 0);
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/health" && request.method === "GET") {
        return await handleHealth(request, env);
      }

      if (path === "/api/v1/products" && request.method === "GET") {
        return await listProducts(request, env, url.searchParams);
      }
      if (path === "/api/v1/products" && request.method === "POST") {
        return await createOrUpdateProduct(request, env);
      }
      if (path.startsWith("/api/v1/products/") && request.method === "GET") {
        return await getProduct(request, env, path.replace("/api/v1/products/", ""));
      }

      if (path === "/api/v1/negotiate/start" && request.method === "POST") {
        return await startNegotiation(request, env);
      }
      if (path.startsWith("/api/v1/negotiate/") && path.endsWith("/offer") && request.method === "POST") {
        const sessionId = path.replace("/api/v1/negotiate/", "").replace("/offer", "");
        return await makeOffer(request, env, sessionId);
      }
      if (path.startsWith("/api/v1/negotiate/") && path.endsWith("/status") && request.method === "GET") {
        const sessionId = path.replace("/api/v1/negotiate/", "").replace("/status", "");
        return await getStatus(request, env, sessionId);
      }

      return jsonResponse(request, env, { detail: "Not Found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(request, env, { detail: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "unexpected error";
      return jsonResponse(request, env, { detail: "Unexpected server error", error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleHealth(request: Request, env: Env): Promise<Response> {
  let dbConnected = false;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  return jsonResponse(request, env, {
    status: "ok",
    engine: "molbhav-cloudflare",
    version: "0.2.0",
    app_env: env.APP_ENV,
    d1_connected: dbConnected,
    kv_bound: Boolean(env.RATE_LIMIT_KV && env.COOLDOWN_KV),
    durable_object_bound: Boolean(env.SESSION_LOCK),
  });
}

async function listProducts(request: Request, env: Env, query: URLSearchParams): Promise<Response> {
  const limit = clampInt(Number(query.get("limit") ?? "50"), 1, 200, 50);
  const skip = Math.max(0, Number(query.get("skip") ?? "0") || 0);
  const rows = await env.DB.prepare(
    "SELECT id, name, category, anchor_price, cost_price, min_margin, target_margin, metadata FROM products ORDER BY id LIMIT ? OFFSET ?"
  ).bind(limit, skip).all();

  const products = ((rows.results ?? []) as Array<{
    id: string;
    name: string;
    category: string;
    anchor_price: number;
    cost_price: number;
    min_margin: number;
    target_margin: number;
    metadata: string;
  }>).map((row) => toProduct(row));
  return jsonResponse(request, env, products);
}

async function getProduct(request: Request, env: Env, productId: string): Promise<Response> {
  if (!PRODUCT_ID_RE.test(productId)) {
    return jsonResponse(request, env, { detail: "Invalid product ID format" }, 400);
  }
  const product = await loadProduct(env, productId);
  if (!product) {
    return jsonResponse(request, env, { detail: "Product not found" }, 404);
  }
  return jsonResponse(request, env, product);
}

async function createOrUpdateProduct(request: Request, env: Env): Promise<Response> {
  const expected = env.API_ADMIN_KEY ?? "";
  const provided = request.headers.get("X-API-Key") ?? "";
  if (!expected || provided !== expected) {
    return jsonResponse(request, env, { detail: "Invalid admin key" }, 401);
  }

  const payload = await parseJson<{ id: string; name: string; category?: string; anchor_price: number; cost_price: number; min_margin: number; target_margin: number; metadata?: Record<string, unknown>; }>(request);
  if (!PRODUCT_ID_RE.test(payload.id)) {
    return jsonResponse(request, env, { detail: "Invalid product ID format" }, 400);
  }
  if (!payload.name || payload.anchor_price <= 0 || payload.cost_price <= 0) {
    return jsonResponse(request, env, { detail: "Invalid product payload" }, 400);
  }
  if (payload.cost_price >= payload.anchor_price) {
    return jsonResponse(request, env, { detail: "cost_price must be less than anchor_price" }, 400);
  }
  if (payload.min_margin <= 0 || payload.min_margin > 1 || payload.target_margin <= 0 || payload.target_margin > 1 || payload.min_margin > payload.target_margin) {
    return jsonResponse(request, env, { detail: "Invalid margin bounds" }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO products (id, name, category, anchor_price, cost_price, min_margin, target_margin, metadata, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       category = excluded.category,
       anchor_price = excluded.anchor_price,
       cost_price = excluded.cost_price,
       min_margin = excluded.min_margin,
       target_margin = excluded.target_margin,
       metadata = excluded.metadata,
       updated_at = datetime('now')`
  ).bind(
    payload.id,
    payload.name,
    payload.category ?? "general",
    payload.anchor_price,
    payload.cost_price,
    payload.min_margin,
    payload.target_margin,
    JSON.stringify(payload.metadata ?? {})
  ).run();

  return jsonResponse(request, env, { status: "created", id: payload.id }, 201);
}

async function startNegotiation(request: Request, env: Env): Promise<Response> {
  const payload = await parseJson<{ product_id: string; buyer_name?: string; language?: string }>(request);
  if (!PRODUCT_ID_RE.test(payload.product_id)) {
    return jsonResponse(request, env, { detail: "Invalid product ID format" }, 400);
  }

  const ip = getClientIp(request);
  const limit = parseIntSafe(env.MAX_REQUESTS_PER_MINUTE_PER_IP, 30);
  const allowed = await checkRateLimit(env, ip, limit);
  if (!allowed) {
    return jsonResponse(request, env, { detail: "Rate limit exceeded. Try again later." }, 429);
  }

  const product = await loadProduct(env, payload.product_id);
  if (!product) {
    return jsonResponse(request, env, { detail: `Product ${payload.product_id} not found` }, 404);
  }

  const now = new Date();
  const ttlSeconds = parseIntSafe(env.DEFAULT_SESSION_TTL_SECONDS, 300);
  const session: SessionRecord = {
    session_id: randomHexId(16),
    session_token: randomHexId(24),
    product_id: product.id,
    product_name: product.name,
    anchor_price: product.anchor_price,
    reservation_price: product.reservation_price,
    beta: parseFloatSafe(env.DEFAULT_BETA, 5),
    alpha: parseFloatSafe(env.DEFAULT_ALPHA, 0.6),
    max_rounds: parseIntSafe(env.DEFAULT_MAX_ROUNDS, 10),
    current_round: 0,
    ttl_seconds: ttlSeconds,
    state: "proposing",
    current_seller_price: product.anchor_price,
    agreed_price: null,
    bot_score: 0,
    buyer_ip: ip,
    offer_history: [
      {
        round: 0,
        actor: "seller",
        price: product.anchor_price,
        message: "Opening offer",
        concession_delta: 0,
        timestamp: now.toISOString(),
      },
    ],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };

  const openingMessage = await generateDialogue(env, session, {
    counter_price: product.anchor_price,
    tactic: "opening",
    state: "proposing",
  }, payload.buyer_name ? `Hi, I am ${payload.buyer_name}` : "Hi");

  await saveSession(env, session);
  await appendLog(env, session.session_id, "session_started", {
    product_id: product.id,
    price: product.anchor_price,
  });

  const response: NegotiationResponse = {
    session_id: session.session_id,
    session_token: session.session_token,
    message: openingMessage.message,
    current_price: product.anchor_price,
    anchor_price: session.anchor_price,
    state: "proposing",
    tactic: "opening",
    sentiment: openingMessage.sentiment,
    rationale: openingMessage.rationale,
    round: 0,
    max_rounds: session.max_rounds,
    quote_ttl_seconds: session.ttl_seconds,
    agreed_price: null,
    metadata: {
      model: openingMessage.model,
      provider: openingMessage.provider,
      rationale: openingMessage.rationale,
    },
  };

  return jsonResponse(request, env, response);
}

async function makeOffer(request: Request, env: Env, sessionId: string): Promise<Response> {
  if (!SESSION_ID_RE.test(sessionId)) {
    return jsonResponse(request, env, { detail: "Invalid session ID format" }, 400);
  }

  const payload = await parseJson<{ message?: string; price: number; language?: string }>(request);
  if (!Number.isFinite(payload.price) || payload.price <= 0) {
    return jsonResponse(request, env, { detail: "buyer_price must be positive" }, 400);
  }

  const providedToken = request.headers.get("X-Session-Token") ?? "";
  const session = await loadSession(env, sessionId);
  if (!session) {
    return jsonResponse(request, env, { detail: "Session not found or expired" }, 404);
  }
  if (providedToken !== session.session_token) {
    return jsonResponse(request, env, { detail: "Invalid session token" }, 401);
  }
  if (session.state === "agreed" || session.state === "broken" || session.state === "timed_out") {
    return jsonResponse(request, env, { detail: `Session is already ${session.state}` }, 400);
  }

  const cooling = await isCoolingDown(env, sessionId);
  if (cooling) {
    return jsonResponse(request, env, { detail: "Please wait before making another offer." }, 429);
  }

  try {
    await acquireSessionLock(env, sessionId);
  } catch {
    return jsonResponse(request, env, { detail: "Session is busy. Please retry." }, 409);
  }

  try {
    const freshSession = await loadSession(env, sessionId);
    if (!freshSession) {
      return jsonResponse(request, env, { detail: "Session not found or expired" }, 404);
    }
    if (providedToken !== freshSession.session_token) {
      return jsonResponse(request, env, { detail: "Invalid session token" }, 401);
    }

    const normalizedMessage = sanitizeBuyerMessage(payload.message ?? "");
    const exitIntent = detectExitIntent(normalizedMessage);
    const engine = runNegotiationTurn(freshSession, payload.price, normalizedMessage, exitIntent);

    let dialogue = await generateDialogue(env, freshSession, engine, normalizedMessage, payload.language ?? "en");

    if (dialogue.timed_out && engine.state === "responding") {
      const adjusted = validatePrice(engine.counter_price * 0.95, freshSession.reservation_price, freshSession.anchor_price);
      if (adjusted.price !== engine.counter_price) {
        engine.counter_price = adjusted.price;
        freshSession.current_seller_price = adjusted.price;
        for (let idx = freshSession.offer_history.length - 1; idx >= 0; idx--) {
          if (freshSession.offer_history[idx].actor === "seller") {
            freshSession.offer_history[idx].price = adjusted.price;
            break;
          }
        }
      }
      dialogue = {
        ...dialogue,
        rationale: "LLM timeout fallback applied",
      };
    }

    freshSession.updated_at = new Date().toISOString();
    freshSession.expires_at = new Date(Date.now() + freshSession.ttl_seconds * 1000).toISOString();
    await saveSession(env, freshSession);
    await setCooldown(env, sessionId, parseIntSafe(env.MIN_RESPONSE_DELAY_MS, 2000));
    await appendLog(env, sessionId, "turn_processed", {
      round: freshSession.current_round,
      buyer_price: payload.price,
      counter_price: engine.counter_price,
      state: engine.state,
      tactic: engine.tactic,
      exit_intent: exitIntent.trigger,
      model: dialogue.model,
    });

    const response: NegotiationResponse = {
      session_id: freshSession.session_id,
      session_token: freshSession.session_token,
      message: dialogue.message,
      current_price: engine.counter_price,
      anchor_price: freshSession.anchor_price,
      state: engine.state,
      tactic: engine.tactic,
      sentiment: dialogue.sentiment,
      rationale: dialogue.rationale,
      round: freshSession.current_round,
      max_rounds: freshSession.max_rounds,
      quote_ttl_seconds: freshSession.ttl_seconds,
      agreed_price: freshSession.agreed_price,
      metadata: {
        model: dialogue.model,
        provider: dialogue.provider,
        rationale: dialogue.rationale,
        exit_intent: exitIntent.trigger,
      },
    };

    return jsonResponse(request, env, response);
  } finally {
    await releaseSessionLock(env, sessionId);
  }
}

async function getStatus(request: Request, env: Env, sessionId: string): Promise<Response> {
  if (!SESSION_ID_RE.test(sessionId)) {
    return jsonResponse(request, env, { detail: "Invalid session ID format" }, 400);
  }
  const session = await loadSession(env, sessionId);
  if (!session) {
    return jsonResponse(request, env, { detail: "Session not found or expired" }, 404);
  }
  const providedToken = request.headers.get("X-Session-Token") ?? "";
  if (providedToken !== session.session_token) {
    return jsonResponse(request, env, { detail: "Invalid session token" }, 401);
  }
  return jsonResponse(request, env, {
    session_id: session.session_id,
    state: session.state,
    current_round: session.current_round,
    max_rounds: session.max_rounds,
    current_seller_price: session.current_seller_price,
    agreed_price: session.agreed_price,
  });
}

function runNegotiationTurn(
  session: SessionRecord,
  buyerPrice: number,
  buyerMessage: string,
  exitIntent: { isLeaving: boolean; confidence: number; trigger: string },
): { counter_price: number; tactic: string; state: NegotiationState } {
  session.current_round += 1;
  session.state = "responding";
  const now = new Date().toISOString();

  const buyerOffers = session.offer_history.filter((offer) => offer.actor === "buyer");
  const previousBuyer = buyerOffers.length ? buyerOffers[buyerOffers.length - 1].price : null;
  const buyerOffer: Offer = {
    round: session.current_round,
    actor: "buyer",
    price: buyerPrice,
    message: buyerMessage,
    concession_delta: previousBuyer !== null ? buyerPrice - previousBuyer : 0,
    timestamp: now,
  };
  session.offer_history.push(buyerOffer);

  if (exitIntent.isLeaving && exitIntent.confidence >= 0.5) {
    const rescuePrice = session.current_seller_price * 0.95;
    if (rescuePrice < session.reservation_price) {
      session.state = "broken";
      session.updated_at = now;
      return {
        counter_price: session.reservation_price,
        tactic: "walk_away_failed",
        state: session.state,
      };
    }

    const validated = validatePrice(rescuePrice, session.reservation_price, session.anchor_price);
    const before = session.current_seller_price;
    session.current_seller_price = validated.price;
    session.offer_history.push({
      round: session.current_round,
      actor: "seller",
      price: validated.price,
      message: "walk_away_save",
      concession_delta: round2(Math.max(0, before - validated.price)),
      timestamp: now,
    });
    session.updated_at = now;
    return {
      counter_price: validated.price,
      tactic: "walk_away_save",
      state: session.state,
    };
  }

  const baseline = computeOffer(session.anchor_price, session.reservation_price, session.current_round, session.max_rounds, session.beta);
  if (buyerPrice >= baseline) {
    session.state = "agreed";
    session.agreed_price = round2(buyerPrice);
    session.updated_at = now;
    return {
      counter_price: session.agreed_price,
      tactic: "accept",
      state: session.state,
    };
  }

  if (session.current_round >= session.max_rounds) {
    session.state = "timed_out";
    session.updated_at = now;
    return {
      counter_price: session.reservation_price,
      tactic: "timeout_final",
      state: session.state,
    };
  }

  const currentPrice = session.current_seller_price || session.anchor_price;
  const aiDrop = computeAiConcession(session.offer_history, session.alpha, Math.max(1, Math.abs(session.anchor_price - session.reservation_price) * 0.1));
  const mirrored = currentPrice - aiDrop;
  const candidate = Math.min(currentPrice, Math.max(baseline, mirrored));
  const validated = validatePrice(candidate, session.reservation_price, session.anchor_price);

  session.offer_history.push({
    round: session.current_round,
    actor: "seller",
    price: validated.price,
    message: "counter",
    concession_delta: round2(Math.max(0, currentPrice - validated.price)),
    timestamp: now,
  });
  session.current_seller_price = validated.price;
  session.updated_at = now;

  return {
    counter_price: validated.price,
    tactic: classifyTactic(currentPrice, validated.price, session.anchor_price, session.reservation_price),
    state: session.state,
  };
}

function computeOffer(anchor: number, reservation: number, currentRound: number, maxRounds: number, beta: number): number {
  if (maxRounds <= 0 || currentRound <= 0) {
    return round2(anchor);
  }
  const t = Math.min(currentRound, maxRounds);
  const ratio = t / maxRounds;
  const curve = ratio ** beta;
  const price = anchor + (reservation - anchor) * curve;
  return round2(Math.max(reservation, Math.min(anchor, price)));
}

function computeAiConcession(offers: Offer[], alpha: number, maxConcession: number): number {
  const buyerOffers = offers.filter((offer) => offer.actor === "buyer").map((offer) => offer.price);
  if (buyerOffers.length < 2) {
    return 0;
  }
  const deltas: number[] = [];
  for (let idx = 1; idx < buyerOffers.length; idx++) {
    deltas.push(buyerOffers[idx] - buyerOffers[idx - 1]);
  }
  const windowed = deltas.slice(-3);
  const avg = windowed.reduce((sum, value) => sum + value, 0) / windowed.length;
  if (avg <= 0) {
    return 0;
  }
  return round2(Math.min(maxConcession, alpha * avg));
}

function classifyTactic(currentPrice: number, newPrice: number, anchor: number, reservation: number): string {
  const range = anchor - reservation;
  if (range <= 0) {
    return "hold_firm";
  }
  const dropRatio = (currentPrice - newPrice) / range;
  if (dropRatio <= 0.01) return "hold_firm";
  if (dropRatio <= 0.05) return "minor_concession";
  if (dropRatio <= 0.15) return "concession";
  return "major_concession";
}

function validatePrice(proposed: number, reservation: number, anchor: number): { price: number; overridden: boolean } {
  if (!Number.isFinite(proposed)) {
    return { price: reservation, overridden: true };
  }
  if (proposed < reservation) {
    return { price: reservation, overridden: true };
  }
  if (proposed > anchor) {
    return { price: anchor, overridden: true };
  }
  return { price: round2(proposed), overridden: false };
}

function detectExitIntent(message: string): { isLeaving: boolean; confidence: number; trigger: string } {
  const text = message.toLowerCase().trim();
  for (const term of EXIT_TERMS) {
    if (text.includes(term)) {
      return { isLeaving: true, confidence: 0.75, trigger: term };
    }
  }
  return { isLeaving: false, confidence: 0, trigger: "" };
}

function sanitizeBuyerMessage(message: string): string {
  const clean = message.slice(0, 500).replace(/[\x00-\x1f\x7f]/g, "");
  if (INJECTION_PATTERN.test(clean)) {
    return "[redacted for safety]";
  }
  return clean;
}

async function generateDialogue(
  env: Env,
  session: SessionRecord,
  result: { counter_price: number; tactic: string; state: NegotiationState },
  buyerMessage: string,
  language = "en",
): Promise<DialogueResult> {
  const prompt = buildDialoguePrompt(session, result, buyerMessage, language);
  const providerOrder = resolveProviderOrder(env.LLM_PROVIDER_ORDER);
  let attemptedProvider = false;
  let sawTimeout = false;

  for (const provider of providerOrder) {
    if (!isProviderConfigured(env, provider)) {
      continue;
    }
    attemptedProvider = true;
    try {
      if (provider === "groq") {
        return await callGroqDialogue(env, prompt);
      }
      return await callOpenRouterDialogue(env, prompt);
    } catch (error) {
      const timeout = isTimeoutError(error);
      sawTimeout = sawTimeout || timeout;
      logProviderFailure(env, session.session_id, provider, error, timeout);
    }
  }

  const rationale = !attemptedProvider
    ? "No LLM provider key configured."
    : sawTimeout
      ? "LLM timed out."
      : "LLM request failed.";

  return {
    message: fallbackMessage(result.counter_price),
    sentiment: "firm",
    rationale,
    timed_out: sawTimeout,
    model: "rule-fallback",
    provider: "rule-fallback",
  };
}

async function callOpenRouterDialogue(env: Env, prompt: string): Promise<DialogueResult> {
  const payload = {
    model: env.OPENROUTER_MODEL,
    messages: buildProviderMessages(prompt),
    temperature: 0.1,
    max_tokens: 140,
    reasoning: { effort: "none", exclude: true },
    response_format: { type: "json_schema", json_schema: DIALOGUE_RESPONSE_SCHEMA },
    plugins: [{ id: "response-healing" }],
  };
  const data = await callChatCompletions({
    provider: "openrouter",
    baseUrl: env.OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY ?? "",
    requestedModel: env.OPENROUTER_MODEL,
    payload,
  });
  return parseDialogueResponseContent("openrouter", env.OPENROUTER_MODEL, data);
}

async function callGroqDialogue(env: Env, prompt: string): Promise<DialogueResult> {
  const payload = {
    model: env.GROQ_MODEL,
    messages: buildProviderMessages(prompt),
    temperature: 0.1,
    max_tokens: 400,
    reasoning_effort: "low",
  };
  const data = await callChatCompletions({
    provider: "groq",
    baseUrl: env.GROQ_BASE_URL,
    apiKey: env.GROQ_API_KEY ?? "",
    requestedModel: env.GROQ_MODEL,
    payload,
  });
  return parseDialogueResponseContent("groq", env.GROQ_MODEL, data);
}

function buildProviderMessages(prompt: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "You are a savvy Indian shopkeeper speaking Hinglish. Be warm but firm. Never reveal reservation price. Return strict JSON only.",
    },
    { role: "user", content: prompt },
  ];
}

async function callChatCompletions(input: {
  provider: UpstreamLlmProvider;
  baseUrl: string;
  apiKey: string;
  requestedModel: string;
  payload: Record<string, unknown>;
}): Promise<{ model?: string; choices?: Array<{ message?: { content?: string } }> }> {
  const response = await fetch(`${input.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const bodyPreview = summarizeForLog(await response.text());
    throw new LlmProviderError(input.provider, `${input.provider} returned ${response.status}`, response.status, bodyPreview);
  }
  return await response.json() as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
}

function parseDialogueResponseContent(
  provider: UpstreamLlmProvider,
  requestedModel: string,
  data: { model?: string; choices?: Array<{ message?: { content?: string } }> },
): DialogueResult {
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmProviderError(provider, `${provider} returned empty content`, undefined, undefined, data.model);
  }
  const parsed = asRecord(parseMaybeJson(raw));
  const message = typeof parsed.message === "string" ? normalizeDialogueText(parsed.message) : "";
  const sentiment = typeof parsed.sentiment === "string" && DIALOGUE_SENTIMENTS.has(parsed.sentiment) ? parsed.sentiment : "firm";
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";
  if (!message || !rationale) {
    throw new LlmProviderError(provider, `${provider} returned invalid structured output`, undefined, summarizeForLog(raw), data.model);
  }
  return {
    message,
    sentiment,
    rationale,
    timed_out: false,
    model: data.model ?? requestedModel,
    provider,
  };
}

function isProviderConfigured(env: Env, provider: UpstreamLlmProvider): boolean {
  if (provider === "groq") {
    return Boolean(env.GROQ_API_KEY);
  }
  return Boolean(env.OPENROUTER_API_KEY);
}

function resolveProviderOrder(config: string | undefined): UpstreamLlmProvider[] {
  const defaults: UpstreamLlmProvider[] = ["groq", "openrouter"];
  if (!config?.trim()) {
    return defaults;
  }
  const normalized = config
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is UpstreamLlmProvider => item === "groq" || item === "openrouter");
  if (!normalized.length) {
    return defaults;
  }
  return Array.from(new Set(normalized));
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name.toLowerCase().includes("abort");
}

function logProviderFailure(
  env: Env,
  sessionId: string,
  provider: UpstreamLlmProvider,
  error: unknown,
  timeout: boolean,
): void {
  const details = error instanceof LlmProviderError ? error : null;
  console.error(`${provider}_dialogue_failed`, {
    app_env: env.APP_ENV,
    session_id: sessionId,
    provider,
    requested_model: provider === "groq" ? env.GROQ_MODEL : env.OPENROUTER_MODEL,
    returned_model: details?.returnedModel,
    status: details?.status,
    body_preview: details?.bodyPreview,
    timeout,
    error: error instanceof Error ? error.message : String(error),
  });
}

function buildDialoguePrompt(
  session: SessionRecord,
  result: { counter_price: number; tactic: string; state: NegotiationState },
  buyerMessage: string,
  language: string,
): string {
  const history = session.offer_history.slice(-6).map((offer) => `${offer.actor === "buyer" ? "Customer" : "Shopkeeper"}: ${offer.price}`).join("\n");
  return [
    "Conversation state:",
    `- Product: ${session.product_name}`,
    `- Round: ${session.current_round}/${session.max_rounds}`,
    `- Language preference: ${language}`,
    `- Current system price (must use exactly): ${result.counter_price}`,
    `- Tactic: ${result.tactic}`,
    `- Buyer message: ${buyerMessage}`,
    `- Recent history:\n${history || "No prior turns."}`,
    'Return strict JSON with exactly these keys only: message, sentiment, rationale.',
    "message: one short Hinglish sentence, max 20 words, include the exact system price, no leading punctuation.",
    "sentiment: one of friendly, firm, celebratory, urgent.",
    "rationale: max 8 words.",
  ].join("\n");
}

function fallbackMessage(price: number): string {
  return `Arre bhai, aapke liye best rate Rs ${price.toFixed(2)}. Isse kam mushkil hai.`;
}

function normalizeDialogueText(input: string): string {
  return input.replace(/^[^A-Za-z0-9]+/, "").replace(/\s+/g, " ").trim();
}

function summarizeForLog(input: string, maxLength = 240): string {
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function loadProduct(env: Env, productId: string): Promise<Product | null> {
  const row = await env.DB.prepare(
    "SELECT id, name, category, anchor_price, cost_price, min_margin, target_margin, metadata FROM products WHERE id = ?1 LIMIT 1"
  ).bind(productId).first();
  if (!row) {
    return null;
  }
  return toProduct(row as {
    id: string;
    name: string;
    category: string;
    anchor_price: number;
    cost_price: number;
    min_margin: number;
    target_margin: number;
    metadata: string;
  });
}

function toProduct(row: {
  id: string;
  name: string;
  category: string;
  anchor_price: number;
  cost_price: number;
  min_margin: number;
  target_margin: number;
  metadata: string;
}): Product {
  const reservation = round2(row.cost_price * (1 + row.min_margin));
  const target = round2(row.cost_price * (1 + row.target_margin));
  const metadata = asRecord(parseMaybeJson(row.metadata));
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    anchor_price: row.anchor_price,
    cost_price: row.cost_price,
    min_margin: row.min_margin,
    target_margin: row.target_margin,
    metadata,
    reservation_price: reservation,
    target_price: target,
  };
}

async function loadSession(env: Env, sessionId: string): Promise<SessionRecord | null> {
  const row = await env.DB.prepare(
    `SELECT session_id, session_token, product_id, product_name, anchor_price, reservation_price,
            beta, alpha, max_rounds, current_round, ttl_seconds, state, current_seller_price,
            agreed_price, bot_score, buyer_ip, offer_history, created_at, updated_at, expires_at
       FROM sessions
      WHERE session_id = ?1
      LIMIT 1`
  ).bind(sessionId).first();

  if (!row) {
    return null;
  }

  const typedRow = row as {
    session_id: string;
    session_token: string;
    product_id: string;
    product_name: string;
    anchor_price: number;
    reservation_price: number;
    beta: number;
    alpha: number;
    max_rounds: number;
    current_round: number;
    ttl_seconds: number;
    state: NegotiationState;
    current_seller_price: number;
    agreed_price: number | null;
    bot_score: number;
    buyer_ip: string;
    offer_history: string;
    created_at: string;
    updated_at: string;
    expires_at: string;
  };

  if (Date.parse(typedRow.expires_at) < Date.now()) {
    return null;
  }

  return {
    ...typedRow,
    offer_history: parseOfferHistory(typedRow.offer_history),
  };
}

async function saveSession(env: Env, session: SessionRecord): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sessions (
       session_id, session_token, product_id, product_name, anchor_price, reservation_price,
       beta, alpha, max_rounds, current_round, ttl_seconds, state, current_seller_price,
       agreed_price, bot_score, buyer_ip, offer_history, created_at, updated_at, expires_at
     )
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
     ON CONFLICT(session_id) DO UPDATE SET
       session_token = excluded.session_token,
       product_id = excluded.product_id,
       product_name = excluded.product_name,
       anchor_price = excluded.anchor_price,
       reservation_price = excluded.reservation_price,
       beta = excluded.beta,
       alpha = excluded.alpha,
       max_rounds = excluded.max_rounds,
       current_round = excluded.current_round,
       ttl_seconds = excluded.ttl_seconds,
       state = excluded.state,
       current_seller_price = excluded.current_seller_price,
       agreed_price = excluded.agreed_price,
       bot_score = excluded.bot_score,
       buyer_ip = excluded.buyer_ip,
       offer_history = excluded.offer_history,
       updated_at = excluded.updated_at,
       expires_at = excluded.expires_at`
  ).bind(
    session.session_id,
    session.session_token,
    session.product_id,
    session.product_name,
    session.anchor_price,
    session.reservation_price,
    session.beta,
    session.alpha,
    session.max_rounds,
    session.current_round,
    session.ttl_seconds,
    session.state,
    session.current_seller_price,
    session.agreed_price,
    session.bot_score,
    session.buyer_ip,
    JSON.stringify(session.offer_history),
    session.created_at,
    session.updated_at,
    session.expires_at,
  ).run();
}

async function appendLog(env: Env, sessionId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO negotiation_logs (session_id, event, payload) VALUES (?1, ?2, ?3)"
  ).bind(sessionId, event, JSON.stringify(payload)).run();
}

async function checkRateLimit(env: Env, ip: string, maxPerMinute: number): Promise<boolean> {
  if (!ip) {
    return true;
  }
  const now = Date.now();
  const key = `rl:${ip}`;
  const raw = await env.RATE_LIMIT_KV.get(key);
  const current = raw ? asRecord(parseMaybeJson(raw)) : {};
  const resetAt = typeof current.resetAt === "number" && current.resetAt > now ? current.resetAt : now + 60000;
  const count = typeof current.count === "number" && resetAt > now ? current.count + 1 : 1;
  await env.RATE_LIMIT_KV.put(key, JSON.stringify({ count, resetAt }), { expirationTtl: 120 });
  return count <= maxPerMinute;
}

async function isCoolingDown(env: Env, sessionId: string): Promise<boolean> {
  const value = await env.COOLDOWN_KV.get(`cooldown:${sessionId}`);
  if (!value) {
    return false;
  }
  const expiresAt = Number.parseInt(value, 10);
  if (!Number.isFinite(expiresAt)) {
    return false;
  }
  return expiresAt > Date.now();
}

async function setCooldown(env: Env, sessionId: string, minDelayMs: number): Promise<void> {
  const expiresAt = Date.now() + minDelayMs;
  // KV requires expirationTtl >= 60, so we keep a short logical cooldown timestamp in value.
  await env.COOLDOWN_KV.put(`cooldown:${sessionId}`, String(expiresAt), { expirationTtl: 60 });
}

async function acquireSessionLock(env: Env, sessionId: string): Promise<void> {
  const id = env.SESSION_LOCK.idFromName(sessionId);
  const stub = env.SESSION_LOCK.get(id);
  const response = await stub.fetch("https://session-lock/acquire", { method: "POST" });
  if (!response.ok) {
    throw new Error("lock acquisition failed");
  }
}

async function releaseSessionLock(env: Env, sessionId: string): Promise<void> {
  const id = env.SESSION_LOCK.idFromName(sessionId);
  const stub = env.SESSION_LOCK.get(id);
  await stub.fetch("https://session-lock/release", { method: "POST" });
}

function getClientIp(request: Request): string {
  const direct = request.headers.get("CF-Connecting-IP");
  if (direct) {
    return direct;
  }
  const forwarded = request.headers.get("X-Forwarded-For");
  if (!forwarded) {
    return "";
  }
  return forwarded.split(",")[0].trim();
}

function buildCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  } else if (!origin && allowedOrigins.length > 0) {
    headers.set("Access-Control-Allow-Origin", allowedOrigins[0]);
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,X-Session-Token,X-API-Key,X-Request-ID");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function jsonResponse(request: Request, env: Env, payload: unknown, status = 200): Response {
  const headers = buildCorsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Request-ID", request.headers.get("X-Request-ID") ?? randomHexId(8));
  return new Response(JSON.stringify(payload), { status, headers });
}

function parseAllowedOrigins(raw: string): string[] {
  const value = (raw ?? "").trim();
  if (!value) {
    return [];
  }
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      return [];
    }
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function parseMaybeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    const match = input.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function parseOfferHistory(raw: string): Offer[] {
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed)) {
    return parsed as Offer[];
  }
  return [];
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function randomHexId(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function parseIntSafe(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatSafe(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
