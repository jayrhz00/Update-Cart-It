-- Demo seed for cart_it
-- Login password for all seeded users: demo123
--
-- STUDENT EXPLANATION:
-- - The API runs this file on every startup (see initializeDatabase in server/index.ts)
--   after tables exist, so PostgreSQL gets rows in all six core tables automatically.
-- - You can also run it manually: psql "$DATABASE_URL" -f server/scripts/seed_demo_data.sql
-- - It uses ON CONFLICT / NOT EXISTS, so rerunning it will not duplicate rows.
-- - It creates two users, two groups, membership links, sample items, price history,
--   and one example notification.

-- 1) Demo users
INSERT INTO users (username, email, password_hash)
VALUES
  ('ayoje_h', 'ayoje@cartit.local', '$2b$10$l8a19bwljsAu1ThualCMo.VNPIgE4H9qoZF.X2.YNo4qXAw0PVCDu'),
  ('jessie_h', 'jessie@cartit.local', '$2b$10$l8a19bwljsAu1ThualCMo.VNPIgE4H9qoZF.X2.YNo4qXAw0PVCDu')
ON CONFLICT (email) DO NOTHING;

-- 2) Demo groups (one private, one shared)
INSERT INTO groups (owner_id, group_name, color, visibility)
SELECT u.user_id, 'Running Gear', '#2563eb', 'Private'
FROM users u
WHERE u.email = 'ayoje@cartit.local'
ON CONFLICT (owner_id, group_name, visibility) DO NOTHING;

INSERT INTO groups (owner_id, group_name, color, visibility)
SELECT u.user_id, 'Home Office', '#7c3aed', 'Shared'
FROM users u
WHERE u.email = 'ayoje@cartit.local'
ON CONFLICT (owner_id, group_name, visibility) DO NOTHING;

-- 3) Group membership links (owner + collaborator)
INSERT INTO group_members (group_id, user_id, role)
SELECT g.group_id, owner.user_id, 'Owner'
FROM groups g
JOIN users owner ON owner.user_id = g.owner_id
WHERE owner.email = 'ayoje@cartit.local'
ON CONFLICT (group_id, user_id) DO NOTHING;

INSERT INTO group_members (group_id, user_id, role)
SELECT g.group_id, editor.user_id, 'Editor'
FROM groups g
JOIN users owner ON owner.user_id = g.owner_id
JOIN users editor ON editor.email = 'jessie@cartit.local'
WHERE owner.email = 'ayoje@cartit.local'
  AND g.group_name = 'Home Office'
ON CONFLICT (group_id, user_id) DO NOTHING;

-- 4) Sample cart items for demos
INSERT INTO cart_items 
(
  user_id, group_id, item_name, product_url, image_url, store, current_price, notes, is_purchased
)
SELECT
  owner.user_id,
  g.group_id,
  'Nike Pegasus 41',
  'https://www.nike.com/t/pegasus-41-road-running-shoes',
  'https://static.nike.com/a/images/pegasus-41.jpg',
  'Nike',
  139.99,
  'Try half size up.',
  FALSE
FROM users owner
JOIN groups g ON g.owner_id = owner.user_id AND g.group_name = 'Running Gear'
WHERE owner.email = 'ayoje@cartit.local'
  AND NOT EXISTS (
    SELECT 1 FROM cart_items c
    WHERE c.user_id = owner.user_id AND c.item_name = 'Nike Pegasus 41'
  );

INSERT INTO cart_items 
(
  user_id, group_id, item_name, product_url, image_url, store, current_price, notes, is_purchased
)
SELECT
  owner.user_id,
  g.group_id,
  'IKEA Markus Chair',
  'https://www.ikea.com/us/en/p/markus-office-chair-vissle-dark-gray-70261150/',
  'https://www.ikea.com/us/en/images/products/markus-office-chair__0724714_pe734597_s5.jpg',
  'IKEA',
  289.00,
  'Check lumbar support before buying.',
  FALSE
FROM users owner
JOIN groups g ON g.owner_id = owner.user_id AND g.group_name = 'Home Office'
WHERE owner.email = 'ayoje@cartit.local'
  AND NOT EXISTS (
    SELECT 1 FROM cart_items c
    WHERE c.user_id = owner.user_id AND c.item_name = 'IKEA Markus Chair'
  );

-- 5) Initial price history rows for analytics/tracking demos
INSERT INTO price_history (item_id, price)
SELECT item.item_id, item.current_price
FROM cart_items item
JOIN users u ON u.user_id = item.user_id
WHERE u.email = 'ayoje@cartit.local'
  AND item.item_name IN ('Nike Pegasus 41', 'IKEA Markus Chair')
  AND NOT EXISTS (
    SELECT 1 FROM price_history ph WHERE ph.item_id = item.item_id
  );

-- 6) Example notification row
INSERT INTO notifications (user_id, item_id, message, is_read)
SELECT item.user_id, item.item_id, 'Price check complete for class demo.', FALSE
FROM cart_items item
JOIN users u ON u.user_id = item.user_id
WHERE u.email = 'ayoje@cartit.local'
  AND item.item_name IN ('Nike Pegasus 41', 'IKEA Markus Chair')
  AND NOT EXISTS (
    SELECT 1
    FROM notifications n
    WHERE n.user_id = item.user_id
      AND n.item_id = item.item_id
      AND n.message = 'Price check complete for class demo.'
  );
