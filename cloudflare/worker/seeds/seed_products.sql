INSERT INTO products (id, name, category, anchor_price, cost_price, min_margin, target_margin, metadata, updated_at)
VALUES
  ('samsung-m15', 'Samsung Galaxy M15', 'electronics', 12999, 8700, 0.05, 0.20, '{"brand":"Samsung","storage":"128GB"}', datetime('now')),
  ('boat-airdopes', 'boAt Airdopes 141', 'electronics', 1499, 520, 0.12, 0.35, '{"brand":"boAt","type":"TWS"}', datetime('now')),
  ('levis-501', 'Levis 501 Original', 'fashion', 4999, 2200, 0.10, 0.30, '{"brand":"Levis","fit":"Regular"}', datetime('now'))
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  category = excluded.category,
  anchor_price = excluded.anchor_price,
  cost_price = excluded.cost_price,
  min_margin = excluded.min_margin,
  target_margin = excluded.target_margin,
  metadata = excluded.metadata,
  updated_at = datetime('now');

