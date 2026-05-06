// Cart-It storage layer
// ---------------------------------------------------------------------------
// STUDENT NOTES — what this file is and why it exists
//
// - "Storage" = the place your API reads/writes users and groups. Routes in `index.ts` import
//   `storage` so they do not scatter the same SQL in twenty different files.
// - `MemStorage` is an in-memory fake database (Maps). Useful to understand CRUD patterns
//   without Postgres; the live server uses `DatabaseStorage` instead.
// - `DatabaseStorage` runs real SQL through `pool` from `db.ts`. Many cart/item routes still
//   use `pool.query` directly in `index.ts` for history — that is OK for a class project; you
//   could gradually move that SQL into this class as you refactor.
// - TypeScript shapes for rows live in `../shared/schema.ts`; this file turns those types
//   into INSERT/SELECT statements.



// Import all data models and insert types from schema.ts file
// Helps storage know the correct structure
import 
{
    User, InsertUser,                    // User = full stored user, InsertUser = data used to create a user
    Group, InsertGroup,                  // Group = full group object, InsertGroup = data used to create group
    GroupMember, InsertGroupMember,      // GroupMember = full membership record, InsertGroupMember = payload to add a member
    Cart, InsertCart,
    Item, InsertItem,
    PriceHistory, InsertPriceHistory,    // PriceHistory = full price record, InsertPriceHistory = data used to save a price check
    Notification, InsertNotification
} from "../shared/schema";

import { pool } from "./db";


// ---- STORAGE INTERFACE ----
// Defines all operations our storage must support 
// "Contract" of what the site will do 
// IStorage says what the storage layer must be able to do


export interface IStorage 
{
    // ---- USER OPERATIONS ----
    getUser(user_id:number): Promise<User | undefined>;                      // Gets a user by their unique ID from the database, returns promise due to db queries
    getUserByEmail(email: string): Promise<User | undefined>;               // Gets user by email (used for login)
    createUser(user: InsertUser): Promise<User>;                            // Creates new user in db, takes in data from signup form, returns full user object

    // ---- GROUP OPERATIONS ----
    getGroup(group_id: number): Promise<Group | undefined>;                            // Find one group by ID  
    getGroupsByOwner(owner_id: number): Promise<Group[]>;                              // Get all groups owned by one user 
    createGroup(group: InsertGroup): Promise<Group>;                                  // Create new group
    updateGroup(group_id: number, group: Partial<Group>): Promise<Group> | undefined;  // Updates group name or color 
    deleteGroup(group_id: number, owner_id: number): Promise<boolean>;                // Deletes only if group belongs to owner

    // ---- GROUP MEMBER OPERATIONS ----
    getGroupMembers(group_id: number): Promise<GroupMember[]>;                        // Returns a list of all members in a shared group
    addGroupMember(member: InsertGroupMember): Promise<GroupMember>;                // Add collaborator
    removeGroupMember(group_id: number, userId: number): Promise<boolean>;           // Removes a user from a group

    // ---- CART OPERATIONS ----
    getCartByUser(user_id: number): Promise<Cart | undefined>;                         // Finds the cart that belongs to a user
    getCart(cart_id: number): Promise<Cart | undefined>;                               // Find cart by cart ID
    createCart(cart: InsertCart): Promise<Cart>;                                      // Create a new cart for user

    // ---- ITEM OPERATIONS ----
    getItem(item_id: number): Promise<Item | undefined>;                               // Get a single item by id or returns undefined if not found 
    getItemsByCart(cart_id: number): Promise<Item[]>;                                  // Get all items in a cart 
    getItemsByGroup(group_id: number): Promise<Item[]>;                                // Get all items in a group
    getItemsByUser(user_id: number): Promise<Item[]>;                                  // Get all items added by a user
    createItem(item: InsertItem): Promise<Item>;                                      // Create new saved item
    updateItem(item_id: number, item: Partial<Item>): Promise<Item | undefined>;       // Update item (internal notes or purchased)  
    deleteItem(item_id: number): Promise<boolean>;                                     // Delete an item by ID 

    // ---- PRICE HISTORY OPERATIONS ----
    getPriceHistory(item_id: number): Promise<PriceHistory[]>;                        // Returns a list of all price records for item
    addPriceRecord(record: InsertPriceHistory): Promise<PriceHistory>;               // Save new price history record

    // ---- NOTIFICATION OPERATIONS ----
    getNotificationsByUser(user_id: number): Promise<Notification[]>;                   // Returns list of notifications for user 
    createNotification(notification: InsertNotification): Promise<Notification>;       // Create notification (price drop)
    markNotificationAsRead(notification_id: number): Promise<Notification | undefined>; // Mark notification as read
}

//---- MEMORY STORAGE ----
// Implementation of IStorage 
// Stores everything in memory using Maps
// Maps is a modern way for storing data. It looks up an item by ID instantly, Easy to add, update, and delete by ID, built into JavaScript 
// WILL BE SWAPPED WITH POSTGRESQL- DatabaseStorage class will be created to implement same interface 


// ---- PRIVATE STORAGE LABELS ----
// Map stores key value pairs
// Everything is stored in memory

export class MemStorage implements IStorage 
{
    private users: Map<number, User>; // Key= userId number, Value = full user object
    private groups: Map<number, Group>;
    private carts: Map<number, Cart>;
    private items: Map<number, Item>;
    private priceHistoryRecords: Map<number, PriceHistory>;
    private notifications: Map<number, Notification>;
    private groupMembers: Map<string, GroupMember>;         // COMPOSITE KEY
 

    private currentUserId: number;
    private currentGroupId: number;
    private currentCartId: number;
    private currentItemId: number;
    private currentHistoryId: number;
    private currentNotificationId: number;

    // Prepares storage system before application starts using it 
    // Will help create empty Maps to act like temp mmory tables
    // Sets starting values 

    constructor()
    {
        this.users = new Map();     // Empty map to store users
        this.groups = new Map();    // Empty map to store groups; Holds all group records while app runs
        this.carts = new Map();     // Empty map to store carts; Each cart is saved here using cartId
        this.items = new Map();     // Empty map to store items; Where each item added to cart or group will be stored
        this.priceHistoryRecords = new Map();       // Stores and tracks price hisory records
        this.notifications = new Map();             // Stores notifications 
        this.groupMembers = new Map();              // Used for relationships between users and groups

        this.currentUserId = 1;     // Start user IDs at 1; Each new user gets next available ID #
        this.currentGroupId = 1;
        this.currentCartId = 1;
        this.currentItemId = 1;
        this.currentHistoryId = 1;
        this.currentNotificationId = 1; 
    }
    
    // Method helps create one string key from groupId and userId
    // Example: groupId 2 + userId 5 becomes "2-5"

    private makeGroupMemberKey(groupId: number, userId: number): string 
    {
        return `${groupId}-${userId}`;      // Combines groupId and userId into one string 
    }

    // ---- USER METHODS ----
    // Responsible for finding and creating users

    async getUser(user_id: number): Promise<User | undefined>  // If the user does not exist, return undefined
    {
        return this.users.get(user_id);        // Look in the users Map using the userId as the key
    }

    // Checks to see if email is registered 
    async getUserByEmail(email: string): Promise<User | undefined>
    {
        for (const user of this.users.values())     // Loop through every user object stored in users map
        {
            if (user.email === email)              // Checks email to match them
            {
                return user;                      // Returns user object if match is found
            }
        }

        return undefined;                       // If no matching email was found, return undefined
    }

    // Create new user and save in memory 
    async createUser(insertUser: InsertUser): Promise<User>
    {
        const user: User =      // Adds values ex. userId & createdAt
        {
            user_id: this.currentUserId++,   // Use current user ID and increment by 1 for next user 
            ...insertUser,                  // Copy all user input fields from insertUser into new object
            created_at: new Date()           // Adds current date and time for when user is created 
        };

        this.users.set(user.user_id, user);  // Saves new user in user maps, Key = userId, Value = full user object
        return user;
    }

    // ---- GROUP METHODS ----

    async getGroup(group_id: number): Promise<Group> | undefined
    {
        return this.groups.get(group_id);
    }

    async getGroupsByOwner(owner_id: number): Promise<Group[]>
    {
        return Array.from(this.groups.values()).filter(
            (group) => group.owner_id === owner_id
        );
    }

    async createGroup(insertGroup: InsertGroup): Promise<Group>
    {
        const group: Group =
        {
            group_id: this.currentGroupId++,
            ...insertGroup,
            created_at: new Date()
        };

        this.groups.set(group.group_id, group);
        return group;
    }

    async updateGroup(group_id: number, updatedFields: Partial<Group>): Promise<Group> | undefined
    {
        const existingGroup = this.groups.get(group_id);

        if (!existingGroup)
        {
            return undefined;
        }

        const updatedGroup: Group =
        {
            ...existingGroup,
            ...updatedFields,
            group_id: existingGroup.group_id
        };

        this.groups.set(group_id, updatedGroup);
        return updatedGroup;
    }

    async deleteGroup(group_id: number, owner_id: number): Promise<boolean>
    {
        const g = this.groups.get(group_id);
        if (!g || g.owner_id !== owner_id) {
            return false;
        }
        return this.groups.delete(group_id);
    }

    // ---- GROUP MEMBER METHODS ----

    async getGroupMembers(group_id: number): Promise<GroupMember[]>
    {
        return Array.from(this.groupMembers.values()).filter(
            (member) => member.group_id === group_id
        );
    }

    async addGroupMember(insertMember: InsertGroupMember): Promise<GroupMember>
    {
        const member: GroupMember =
        {
            ...insertMember,
            joined_at: new Date()
        };

        const key = this.makeGroupMemberKey(member.group_id, member.user_id);
        this.groupMembers.set(key, member);

        return member;
    }

    async removeGroupMember(group_id: number, user_id: number): Promise<boolean>
    {
        const key = this.makeGroupMemberKey(group_id, user_id);
        return this.groupMembers.delete(key);
    }

    // ---- CART METHODS ----

    async getCartByUser(user_id: number): Promise<Cart | undefined>
    {
        for (const cart of this.carts.values())
        {
            if (cart.user_id === user_id)
            {
                return cart;
            }
        }

        return undefined;
    }

    async getCart(cart_id: number): Promise<Cart | undefined>
    {
        return this.carts.get(cart_id);
    }

    async createCart(insertCart: InsertCart): Promise<Cart>
    {
        const cart: Cart =
        {
            cart_id: this.currentCartId++,
            ...insertCart,
            created_at: new Date()
        };

        this.carts.set(cart.cart_id, cart);
        return cart;
    }

    // ---- ITEM METHODS ----

    async getItem(item_id: number): Promise<Item | undefined>
    {
        return this.items.get(item_id);
    }

    async getItemsByCart(cart_id: number): Promise<Item[]>
    {
        return Array.from(this.items.values()).filter(
            (item) => item.cart_id === cart_id
        );
    }

    async getItemsByGroup(group_id: number): Promise<Item[]>
    {
        return Array.from(this.items.values()).filter(
            (item) => item.group_id === group_id
        );
    }

    async getItemsByUser(user_id: number): Promise<Item[]>
    {
        return Array.from(this.items.values()).filter(
            (item) => item.added_by_user_id === user_id
        );
    }

    async createItem(insertItem: InsertItem): Promise<Item>
    {
        // Validation rule:
        // Exactly one location must be set.
        const hasCart = insertItem.cart_id !== null;
        const hasGroup = insertItem.group_id !== null;

        if ((hasCart && hasGroup) || (!hasCart && !hasGroup))
        {
            throw new Error("Item must belong to either a cart or a group, but not both.");
        }

        const item: Item =
        {
            item_id: this.currentItemId++,
            ...insertItem
        };

        this.items.set(item.item_id, item);
        return item;
    }

    async updateItem(item_id: number, updatedFields: Partial<Item>): Promise<Item | undefined>
    {
        const existingItem = this.items.get(item_id);

        if (!existingItem)
        {
            return undefined;
        }

        const updatedItem: Item =
        {
            ...existingItem,
            ...updatedFields,
            item_id: existingItem.item_id
        };

        const hasCart = updatedItem.cart_id !== null;
        const hasGroup = updatedItem.group_id !== null;

        if ((hasCart && hasGroup) || (!hasCart && !hasGroup))
        {
            throw new Error("Updated item must belong to either a cart or a group, but not both.");
        }

        this.items.set(item_id, updatedItem);
        return updatedItem;
    }

    async deleteItem(item_id: number): Promise<boolean>
    {
        return this.items.delete(item_id);
    }

    // ---- PRICE HISTORY METHODS ----

    async getPriceHistory(item_id: number): Promise<PriceHistory[]>
    {
        return Array.from(this.priceHistoryRecords.values()).filter(
            (record) => record.item_id === item_id
        );
    }

    async addPriceRecord(insertRecord: InsertPriceHistory): Promise<PriceHistory>
    {
        const record: PriceHistory =
        {
            history_id: this.currentHistoryId++,
            ...insertRecord
        };

        this.priceHistoryRecords.set(record.history_id, record);
        return record;
    }

    // ---- NOTIFICATION METHODS ----

    async getNotificationsByUser(user_id: number): Promise<Notification[]>
    {
        return Array.from(this.notifications.values()).filter(
            (notification) => notification.user_id === user_id
        );
    }

    async createNotification(insertNotification: InsertNotification): Promise<Notification>
    {
        const notification: Notification =
        {
            notification_id: this.currentNotificationId++,
            ...insertNotification,
            created_at: new Date()
        };

        this.notifications.set(notification.notification_id, notification);
        return notification;
    }

    async markNotificationAsRead(notification_id: number): Promise<Notification | undefined>
    {
        const existingNotification = this.notifications.get(notification_id);

        if (!existingNotification)
        {
            return undefined;
        }

        const updatedNotification: Notification =
        {
            ...existingNotification,
            is_read: true
        };

        this.notifications.set(notification_id, updatedNotification);
        return updatedNotification;
    }
}
export class DatabaseStorage implements IStorage
    {
        // STUDENT NOTE:
        // This class is the real PostgreSQL-backed implementation used at runtime.
        // It currently has core user/group methods implemented, while many optional
        // interface methods are placeholders for future expansion.
        //
        // Why keep placeholders?
        // - The interface documents the full storage contract.
        // - You can implement missing methods incrementally without changing route code.
        // - It shows clear next steps for project growth.

        // Creates new user in PostgreSQL
        async createUser(user: InsertUser): Promise<User>       
        {
            const result = await pool.query
            (
                `INSERT INTO users (username, email, password_hash)
                 VALUES ($1, $2, $3)
                 RETURNING user_id, username, email, password_hash, created_at`,
                 [user.username, user.email, user.password_hash]
            );
            const row = result.rows[0];
            return{
                user_id: row.user_id,
                username: row.username,
                email: row.email,
                password_hash: row.password_hash,
                created_at: row.created_at
            };
        }

        // Gets user by email
        async getUserByEmail(email: string): Promise<User | undefined>
        {
            const result = await pool.query
            (
            "SELECT * FROM users WHERE email = $1",
            [email]
            );

        if (result.rows.length === 0) 
        {
            return undefined;
        } 

        const row = result.rows[0];

        return {
            user_id: row.user_id,
            username: row.username,
            email: row.email,
            password_hash: row.password_hash,
            created_at: row.created_at
        };
    }

        // Gets user by ID
        async getUser(user_id: number): Promise<User | undefined>
        {
            const result = await pool.query
            (
            "SELECT * FROM users WHERE user_id = $1",
            [user_id]
            );

        if (result.rows.length === 0) 
        {
            return undefined;
        } 

        const row = result.rows[0];

        return {
            user_id: row.user_id,
            username: row.username,
            email: row.email,
            password_hash: row.password_hash,
            created_at: row.created_at
        };
    }

    // Get 1 group by ID 
    async getGroup(group_id: number): Promise<Group | undefined>
{
    // Ask PostgreSQL for the group with this ID
    const result = await pool.query(
        `SELECT * FROM groups WHERE group_id = $1`,
        [group_id]
    );

    // If no group is found, return undefined
    if (result.rows.length === 0)
    {
        return undefined;
    }

    // Otherwise return the group
    return result.rows[0];
}


// Get ALL groups for a specific user
async getGroupsByOwner(owner_id: number): Promise<Group[]>
{
    // Get all groups that belong to this user
    const result = await pool.query(
        `SELECT * FROM groups WHERE owner_id = $1 ORDER BY created_at DESC`,
        [owner_id]
    );

    // Return list of groups
    return result.rows;
}


// Create a NEW group
async createGroup(group: InsertGroup): Promise<Group>
{
    // Insert a new group into PostgreSQL
    const result = await pool.query(
        `INSERT INTO groups (owner_id, group_name, color, visibility)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
            group.owner_id,                   // which user owns this group
            group.group_name,                // group name (ex: "Clothing")
            "#6B7280",                       // temporarily disable color coding
            group.visibility ?? "Private"  // default to Private
        ]
    );

    // Return newly created group
    return result.rows[0];
}


// Delete a group (only when owned by the given user)
async deleteGroup(group_id: number, owner_id: number): Promise<boolean>
{
    const result = await pool.query(
        `DELETE FROM groups WHERE group_id = $1 AND owner_id = $2`,
        [group_id, owner_id]
    );

    return (result.rowCount ?? 0) > 0;
}


// Update group (do this later)
async updateGroup(): Promise<Group | undefined>
{
    throw new Error("Not implemented yet");
}

    // Placeholder methods below are intentionally unimplemented in DatabaseStorage.
    // Routes currently use direct SQL for these behaviors in index.ts.
    // If you migrate logic here later, replace each throw with real SQL methods.
    getGroupMembers(): any { throw new Error("Not implemented"); }
    addGroupMember(): any { throw new Error("Not implemented"); }
    removeGroupMember(): any { throw new Error("Not implemented"); }

    getCartByUser(): any { throw new Error("Not implemented"); }
    getCart(): any { throw new Error("Not implemented"); }
    createCart(): any { throw new Error("Not implemented"); }

    getItem(): any { throw new Error("Not implemented"); }
    getItemsByCart(): any { throw new Error("Not implemented"); }
    getItemsByGroup(): any { throw new Error("Not implemented"); }
    getItemsByUser(): any { throw new Error("Not implemented"); }
    createItem(): any { throw new Error("Not implemented"); }
    updateItem(): any { throw new Error("Not implemented"); }
    deleteItem(): any { throw new Error("Not implemented"); }

    getPriceHistory(): any { throw new Error("Not implemented"); }
    addPriceRecord(): any { throw new Error("Not implemented"); }

    getNotificationsByUser(): any { throw new Error("Not implemented"); }
    createNotification(): any { throw new Error("Not implemented"); }
    markNotificationAsRead(): any { throw new Error("Not implemented"); }
}

// ---- EXPORTED STORAGE (singleton) ----
// One shared `storage` object for the whole Node process. All routes import the same instance
// so every request sees the same database connection pool underneath.
export const storage = new DatabaseStorage();



