declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    RATE_LIMIT_KV: KVNamespace;
    COOLDOWN_KV: KVNamespace;
    SESSION_LOCK: DurableObjectNamespace;

    OPENROUTER_API_KEY?: string;
    OPENROUTER_BASE_URL: string;
    OPENROUTER_MODEL: string;
    GROQ_API_KEY?: string;
    GROQ_BASE_URL: string;
    GROQ_MODEL: string;
    LLM_PROVIDER_ORDER: string;
    API_ADMIN_KEY?: string;

    APP_ENV: string;
    CORS_ALLOWED_ORIGINS: string;
    DEFAULT_BETA: string;
    DEFAULT_ALPHA: string;
    DEFAULT_MAX_ROUNDS: string;
    DEFAULT_SESSION_TTL_SECONDS: string;
    MIN_RESPONSE_DELAY_MS: string;
    MAX_REQUESTS_PER_MINUTE_PER_IP: string;
  }
}

interface Env extends Cloudflare.Env {}
