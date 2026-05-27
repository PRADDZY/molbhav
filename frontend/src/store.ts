import { create } from "zustand";
import { fetchProducts, sendOffer, startNegotiation } from "./api";
import type { ChatMessage, NegotiationState, Product } from "./types";

interface AppState {
  products: Product[];
  selectedProduct: Product | null;
  isDrawerOpen: boolean;
  isLoading: boolean;
  error: string;

  sessionId: string;
  sessionToken: string;
  state: NegotiationState;
  currentPrice: number;
  anchorPrice: number;
  round: number;
  maxRounds: number;
  tactic: string;
  rationale: string;
  chat: ChatMessage[];

  loadProducts: () => Promise<void>;
  openNegotiation: (product: Product) => Promise<void>;
  closeNegotiation: () => void;
  submitOffer: (price: number, message: string) => Promise<void>;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const useAppStore = create<AppState>((set, get) => ({
  products: [],
  selectedProduct: null,
  isDrawerOpen: false,
  isLoading: false,
  error: "",

  sessionId: "",
  sessionToken: "",
  state: "idle",
  currentPrice: 0,
  anchorPrice: 0,
  round: 0,
  maxRounds: 0,
  tactic: "",
  rationale: "",
  chat: [],

  loadProducts: async () => {
    set({ isLoading: true, error: "" });
    try {
      const products = await fetchProducts();
      set({ products, isLoading: false });
    } catch (error) {
      set({ isLoading: false, error: (error as Error).message });
    }
  },

  openNegotiation: async (product) => {
    set({
      selectedProduct: product,
      isDrawerOpen: true,
      isLoading: true,
      error: "",
      chat: [],
      state: "idle"
    });

    try {
      const res = await startNegotiation(product.id);
      set({
        sessionId: res.session_id,
        sessionToken: res.session_token,
        state: res.state,
        currentPrice: res.current_price,
        anchorPrice: res.anchor_price,
        round: res.round,
        maxRounds: res.max_rounds,
        tactic: res.tactic,
        rationale: res.rationale,
        chat: [{ id: uid(), from: "seller", text: res.message, price: res.current_price }],
        isLoading: false
      });
    } catch (error) {
      set({ isLoading: false, error: (error as Error).message });
    }
  },

  closeNegotiation: () => {
    set({
      isDrawerOpen: false,
      selectedProduct: null,
      sessionId: "",
      sessionToken: "",
      state: "idle",
      currentPrice: 0,
      anchorPrice: 0,
      round: 0,
      maxRounds: 0,
      tactic: "",
      rationale: "",
      chat: [],
      error: ""
    });
  },

  submitOffer: async (price, message) => {
    const { sessionId, sessionToken, chat } = get();
    if (!sessionId || !sessionToken) {
      return;
    }

    const buyerEntry: ChatMessage = {
      id: uid(),
      from: "buyer",
      text: message.trim() || `₹${price}`,
      price
    };
    set({ isLoading: true, error: "", chat: [...chat, buyerEntry] });

    try {
      const res = await sendOffer(sessionId, sessionToken, price, message);
      set((state) => ({
        isLoading: false,
        state: res.state,
        currentPrice: res.current_price,
        anchorPrice: res.anchor_price,
        round: res.round,
        maxRounds: res.max_rounds,
        tactic: res.tactic,
        rationale: res.rationale,
        chat: [...state.chat, { id: uid(), from: "seller", text: res.message, price: res.current_price }]
      }));
    } catch (error) {
      set({ isLoading: false, error: (error as Error).message });
    }
  }
}));

