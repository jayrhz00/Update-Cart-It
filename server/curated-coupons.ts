
// This file stores a small curated list of official retailer offer pages. (GET /api/public/curated-coupons).

// links users to official retailer pages where stores post
// their own live deals, rewards, membership offers, or promotions.
export interface CuratedCoupon {
  id: string;
  store_name: string;
  store_domain: string | null;
// Cart-It does not offer coupons. 
  code: string | null;
  discount_label: string | null; // Describes type of deal page
  fine_print: string | null;
  expires_at: string | null;
  // Shows where this information comes from for transparency
  source_site: string;
  // Official retailer page where users can check live deals or rewards
  deals_url?: string | null;
}
 // Curated list of official retailer offer/deal pages
 // No coupons 
 // Trusted links to official retailer deal hubs
export const CURATED_COUPONS: CuratedCoupon[] = [
  {
    id: "cur-target-hub",
    store_name: "Target",
    store_domain: "target.com",
    code: null,
    discount_label: "Circle offers & weekly deals",
    fine_print:
      "Promos change often and vary by account. Open Circle for codes that apply to your cart today.",
    expires_at: null,
    source_site: "Target Circle (official)",
    deals_url: "https://www.target.com/circle",
  },
  {
    id: "cur-kohls-hub",
    store_name: "Kohl's",
    store_domain: "kohls.com",
    code: null,
    discount_label: "Coupons & Kohl’s Cash events",
    fine_print: "Stacking rules change by campaign — apply coupons from your Wallet at checkout.",
    expires_at: null,
    source_site: "Kohl’s coupons (official)",
    deals_url: "https://www.kohls.com/sale-event/coupon.jsp",
  },
  {
    id: "cur-sephora-hub",
    store_name: "Sephora",
    store_domain: "sephora.com",
    code: null,
    discount_label: "Beauty Offers & rewards",
    fine_print: "Shipping and promos depend on Beauty Insider tier and cart — check live offers.",
    expires_at: null,
    source_site: "Sephora Beauty Offers (official)",
    deals_url: "https://www.sephora.com/beauty/beauty-offers",
  },
  {
    id: "cur-bestbuy-hub",
    store_name: "Best Buy",
    store_domain: "bestbuy.com",
    code: null,
    discount_label: "Deals of the Day & member offers",
    fine_print: "Student / member discounts require verification in Best Buy’s flow.",
    expires_at: null,
    source_site: "Best Buy Deals (official)",
    deals_url: "https://www.bestbuy.com/deals",
  },
  {
    id: "cur-nike-hub",
    store_name: "Nike",
    store_domain: "nike.com",
    code: null,
    discount_label: "Member promos & seasonal sales",
    fine_print: "Nike publishes member codes in-account — avoid third-party guess codes.",
    expires_at: null,
    source_site: "Nike promotions (official)",
    deals_url: "https://www.nike.com/membership",
  },
  {
    id: "cur-oldnavy-hub",
    store_name: "Old Navy",
    store_domain: "oldnavy.com",
    code: null,
    discount_label: "Sitewide promos & Super Cash",
    fine_print: "Cart-level discounts rotate — confirm in checkout before you pay.",
    expires_at: null,
    source_site: "Old Navy offers (official)",
    deals_url: "https://oldnavy.gap.com/",
  },
];
