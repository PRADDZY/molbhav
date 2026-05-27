export type NegotiationState =
  | "idle"
  | "proposing"
  | "responding"
  | "agreed"
  | "broken"
  | "timed_out";

export interface Product {
  id: string;
  name: string;
  category: string;
  anchor_price: number;
  cost_price: number;
  min_margin: number;
  target_margin: number;
  reservation_price?: number;
  target_price?: number;
  metadata?: Record<string, unknown>;
}

export interface NegotiationResponse {
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

export interface ChatMessage {
  id: string;
  from: "buyer" | "seller";
  text: string;
  price?: number;
}

