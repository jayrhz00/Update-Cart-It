-- Jessie Hernandez 700775688
-- Cart-It DB Schema 
-- Stores raw PostgreSQL table definitions
--
-- STUDENT DEMO TIP: Core tables are users, groups, group_members, cart_items, price_history,
-- notifications. Extra collaboration tables (item_private_notes, item_group_comments,
-- group_comments) are created here too — the API may ALTER/CREATE more at startup in index.ts
-- for backwards compatibility. `initializeDatabase` runs this whole file once when the server boots.
-- In psql: \dt lists tables, \d table_name shows columns.

-- TABLE 1: users
-- Stores each registered Cart-It user

CREATE TABLE IF NOT EXISTS users
(
    user_id SERIAL PRIMARY KEY,                             -- Unique ID for each user 
    username VARCHAR(50) UNIQUE NOT NULL,                   -- Username displayed on site, UNIQUE prevents duplicates
    email VARCHAR(255) UNIQUE NOT NULL,                     -- Email used for login/registration, prevents duplicates
    password_hash TEXT NOT NULL,                            -- Stores hashed pw not the real one 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL -- Automatically stores when account was created 
);

-- TABLE 2: groups
-- Stores categories created by user(clothing, technology,groceries)
-- Each group belongs to one user 

CREATE TABLE IF NOT EXISTS groups
(
    group_id SERIAL PRIMARY KEY,                                -- Unique ID for each group
    owner_id INTEGER NOT NULL,                                  -- User who owns this group
    group_name VARCHAR(100) NOT NULL,                           -- Name of group/category
    color VARCHAR(20) DEFAULT '#6B7280' NOT NULL,              -- Color label for UI display
    visibility VARCHAR(20) DEFAULT 'Private' NOT NULL,         -- Controls whether the group is private or shared 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,   -- Stores when the group was created (auto)

    -- Verifies that owner_id matches a real user in the users table 
    CONSTRAINT fk_groups_owner
        FOREIGN KEY (owner_id)  -- owner_id in groups table must match a real user_id in the users table
        REFERENCES users(user_id)
        ON DELETE CASCADE,      -- If user is deleted, the user's groups will be deleted too

    -- Only allows visibility to be private or shared
    CONSTRAINT chk_groups_visibility
        CHECK (visibility IN ('Private', 'Shared')),    

    -- Example: User can have a private group called "Clothing" and a shared group called "Clothing"
    CONSTRAINT uq_groups_owner_name_visibility
        UNIQUE (owner_id, group_name, visibility)
);

-- TABLE 3: group_members 
-- Connects users to groups for collaboration (m to m relationship)

CREATE TABLE IF NOT EXISTS group_members  
(
    group_id INTEGER NOT NULL,                                 -- Which group user belongs to
    user_id INTEGER NOT NULL,                                   -- Which user is a member of the group
    role VARCHAR(20) NOT NULL,                                  -- Owner/Editor 
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,     -- Stores when the user joined the group 

    -- Verifies that group_id matches a real group in groups table 
    CONSTRAINT fk_group_members_group
        FOREIGN KEY (group_id)
        REFERENCES groups(group_id)
        ON DELETE CASCADE,

    -- Verifies user_id matches real user in user table 
    CONSTRAINT fk_group_members_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    -- Allows role to be owner or editor 
    CONSTRAINT chk_group_members_role
        CHECK (role IN ('Owner', 'Editor')),

    -- Prevents same user from being added to the same group more than once 
    CONSTRAINT pk_group_members
        PRIMARY KEY (group_id, user_id) 
);

-- TABLE 4: cart_items
-- Stores products a user saves (cart only and grouped items)
-- CORE TABLE 

CREATE TABLE IF NOT EXISTS cart_items
(
    item_id SERIAL PRIMARY KEY,                                  -- Unique ID for each saved item (auto)
    user_id INTEGER NOT NULL,                                    -- User who saved this item, every item must belong to a user
    group_id INTEGER,                                            -- Group/category this item belongs to / NULL = item is just in the cart (not categorized)
    item_name VARCHAR(255) NOT NULL,                             -- Name of product (ex: "Gym Shark Leggings")
    product_url TEXT NOT NULL,                                   -- Link to product page
    image_url TEXT,                                              -- Image of product
    store VARCHAR(100),                                          -- Store/website name (ex: Gymshark, Walmart)
    current_price NUMERIC(10,2),                                 -- Current price of item (changes over time)
    is_in_stock BOOLEAN DEFAULT TRUE NOT NULL,                   -- Tracks current stock state from product page checks
    -- STUDENT NOTE: JSON responses ALSO echo friendly aliases from index.ts:
    --   `out_of_stock` == NOT is_in_stock
    --   `purchased`    == is_purchased
    -- The database keeps the original column names so older queries keep working.
    notes TEXT,                                                  -- Private internal notes (size, quality, etc.)
    group_comments TEXT,                                         -- Shared notes visible to all collaborators on this wishlist
    is_purchased BOOLEAN DEFAULT FALSE NOT NULL,                 -- Tracks if user bought the item, Default = false cannot be NULL
    purchase_price NUMERIC(10,2),                                -- Price the user actually paid (if purchased)
    purchase_date TIMESTAMP,                                     -- When item was purchased
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,     -- When item was saved to Cart-It

    -- FOREIGN KEY: links item to a real user
    CONSTRAINT fk_items_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,                                      -- If user is deleted = all their items are deleted too

    -- FOREIGN KEY: links item to a group (if it has one)
    CONSTRAINT fk_items_group
        FOREIGN KEY (group_id)
        REFERENCES groups(group_id)
        ON DELETE SET NULL,                                      -- If group is deleted = item stays, but becomes uncategorized

    -- Prevents current_price from being negative
    -- Null is allowed b/c item might not have price 
    CONSTRAINT chk_cart_items_current_price
        CHECK (current_price IS NULL OR current_price >= 0),

    -- Prevents purchase_price from being negative 
    -- Null b/c item might have not been purchased yet 
    CONSTRAINT chk_cart_items_purchase_price
        CHECK (purchase_price IS NULL OR purchase_price >= 0)
);

-- Per-user private notes for a cart item (not visible to other collaborators)
CREATE TABLE IF NOT EXISTS item_private_notes
(
    item_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_item_private_notes_item
        FOREIGN KEY (item_id) REFERENCES cart_items(item_id) ON DELETE CASCADE,
    CONSTRAINT fk_item_private_notes_user
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, user_id)
);

-- Shared thread: comments on an item visible to everyone with access to the wishlist
CREATE TABLE IF NOT EXISTS item_group_comments
(
    comment_id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_item_group_comments_item
        FOREIGN KEY (item_id) REFERENCES cart_items(item_id) ON DELETE CASCADE,
    CONSTRAINT fk_item_group_comments_user
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_group_comments_item ON item_group_comments(item_id);

-- Shared thread: comments on the wishlist/group itself (not tied to one item)
CREATE TABLE IF NOT EXISTS group_comments
(
    comment_id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_group_comments_group
        FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
    CONSTRAINT fk_group_comments_user
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_group_comments_group ON group_comments(group_id);

-- TABLE 5: price_history 
-- Stores past price records for each saved item 
-- Tracks price changes over time 

CREATE TABLE IF NOT EXISTS price_history
(
    history_id SERIAL PRIMARY KEY,                               -- Unique ID for each price record
    item_id INTEGER NOT NULL,                                    -- Item price that is being tracked
    price NUMERIC(10,2) NOT NULL,                                -- Recorded price at that moment
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,    -- When price was recorded

    CONSTRAINT fk_price_history_item
        FOREIGN KEY (item_id)
        REFERENCES cart_items(item_id)
        ON DELETE CASCADE,                                        -- If item is deleted, its price history is deleted too

    -- Prevents invalid negative values from being saved 
    CONSTRAINT chk_price_history_price
    CHECK (price >= 0)
);

-- TABLE 6: notifications
-- Alerts for the signed-in user (price drops, stock, invites). item_id is optional when the alert is list-level only.

CREATE TABLE IF NOT EXISTS notifications
(
    notification_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    item_id INTEGER,
    group_id INTEGER,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notifications_item
        FOREIGN KEY (item_id)
        REFERENCES cart_items(item_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notifications_group
        FOREIGN KEY (group_id)
        REFERENCES groups(group_id)
        ON DELETE CASCADE
);

-- Sample rows for all six core tables (users, groups, group_members, cart_items,
-- price_history, notifications) are applied at API startup from scripts/seed_demo_data.sql
-- (see initializeDatabase in server/index.ts). That keeps DDL here and idempotent DML there.