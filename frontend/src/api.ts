import type { NegotiationResponse, Product } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || "Request failed");
  }

  return response.json() as Promise<T>;
}

export function fetchProducts(): Promise<Product[]> {
  return request<Product[]>("/api/v1/products");
}

export function startNegotiation(productId: string): Promise<NegotiationResponse> {
  return request<NegotiationResponse>("/api/v1/negotiate/start", {
    method: "POST",
    body: JSON.stringify({ product_id: productId, buyer_name: "", language: "en" })
  });
}

export function sendOffer(
  sessionId: string,
  sessionToken: string,
  price: number,
  message: string
): Promise<NegotiationResponse> {
  return request<NegotiationResponse>(`/api/v1/negotiate/${sessionId}/offer`, {
    method: "POST",
    headers: { "X-Session-Token": sessionToken },
    body: JSON.stringify({ price, message, language: "en" })
  });
}

