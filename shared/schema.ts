//Jessie Hernandez 700775688
// CART-IT DATA MODELS
// This file will be our "blueprint".
// Tells our site what each table/ entity should look like 
// Includes: Collaboration, price history, notes and notifications

// ---- USER ----
// Registered user of Cart-It
// Each user can have multiple groups & items 

export interface User            // Defines the object as "User" that other files will be able to use 
{
    user_id: number;             // Every user gets a unique # as their ID (auto-generated)
    username: string;          // Displays user's username 
    email: string;            // Email address for login 
    password_hash: string;    // Security technique to create hashed password
    created_at: Date;        // Timestamp of when the account was created  
}

// ---- GROUP ----
// Folder to organize cart items. 
// Think different categories like "Clothing", "Technology",etc..
// Each group belongs to one user but can be shared with collaborators

export interface Group
{
    group_id: number;                  // Unique ID
    owner_id: number;                  // Which user owns this group (links to User.userId) 
    group_name: string;               // Category name 
    color?: string | null;            // Color of sidebar label
    visibility?: string | null;       // "Private" or "Shared"
    created_at: Date;                  // Timestamp when group was created  
}

export interface InsertGroup 
{
    owner_id: number;
    group_name: string;
    color?: string | null;
    visibility?: string | null;
}


// ---- GROUP MEMBER ----
// Connects users to shared groups (many-to-many)
// Owner of group invites others by email

export interface GroupMember
{
    group_id: number;       // PK/FK Group.groupId     
    user_id: number;       // PK/FK User.userId  
    role: string;        // "Owner" or "Editor" 
    joined_at: Date;     // Timestamp of when member was added

}

// ---- CART ----
// Stores a user's private uncategorized items 
// One cart belongs to one user 

export interface Cart
{
    cart_id: number;                 // Primary key: unique ID for each cart
    user_id: number;                 // Which user owns this cart 
    created_at: Date;                // Timestamp of when the cart was created 
}

// ---- ITEM ----
// A saved product 
// Item belongs to either a CART or a GROUP, but not both 

export interface Item
{
    item_id: number;                   // Unique ID for each saved item
    cart_id: number | null;           // Null if item is stored in group 
    group_id: number | null;         // Null if item is stored in cart
    added_by_user_id: number;         // FK -> User.userId records who saved the item

    product_name: string;            // Product's name 
    product_url: string;             // Link to product page
    image_url: string;               // Link to product image url
    store_name: string;              // Which store/site product is in
    current_price: number;           // Current known price of item
    notes: string;                  // Private internal notes user can make about the item 
    is_purchased: boolean;           // Has the user bought this item before? T/F 
}


// ---- PRICE HISTORY ----
// Records price changes over time for tracked items 
// Use case 5 (Milestone 1 Documents) System runs scheduled price check 
// If the price has changed a new record will be saved 

export interface PriceHistory 
{
    history_id: number;              // Unique ID for each price record
    item_id: number;                 // Which cart item this price is for 
    price: number;                  // Current price at the time of check
    checked_at: Date;                // When the price was checked 
}

// ---- NOTIFICATION ----
// Records when the system alerts the user 
// Use Case 6: System detects price drop and notifies user via email (Milestone 1)

export interface Notification 
{
    notification_id: number;         // Unique ID for each notification
    user_id: number;                 // Who gets notified
    item_id: number;                 // Which item dropped in price
    message: string;                // Notification message 
    is_read: boolean;                // Has the notification been read?
    created_at: Date;                // Timestamp of when notification was created 
}

// ---- INSERT TYPES ----
// When creating new records, id and timestamps are auto generated
// These types represent what the user fills in

export type InsertUser = Omit<User, "user_id" | "created_at">;
//export type InsertGroup = Omit<Group, "group_id" | "created_at">;
export type InsertGroupMember = Omit<GroupMember, "joined_at">;
export type InsertCart = Omit<Cart, "cart_id" | "created_at">;
export type InsertItem= Omit<Item, "item_id">;
export type InsertPriceHistory = Omit<PriceHistory, "history_id">;
export type InsertNotification = Omit<Notification, "notification_id" | "created_at">;