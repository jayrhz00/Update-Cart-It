import React from "react";
import { Link } from "react-router-dom";
import "../styles/privacy-policy.css";

const PrivacyPolicy = () => {
  return (
    <div className="privacy-page">
      <header className="privacy-header">
        <img src="/logo.svg" alt="Cart-It" style={{ width: 120, height: "auto" }} />
        <Link to="/" className="privacy-back">
          ← Back to home
        </Link>
      </header>

      <main className="privacy-main">
        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Last updated: May 3, 2026</p>

        <p>
          Cart-It (&quot;we&quot;, &quot;us&quot;) provides a web app and browser extension that help you save
          and organize product links and related information in wishlists. This policy describes how we handle
          information when you use our service.
        </p>

        <h2>Information we collect</h2>
        <ul>
          <li>
            <strong>Account information:</strong> when you register, we collect your username, email address,
            and a password. Passwords are stored using secure hashing on our servers; we do not store your
            password in plain text.
          </li>
          <li>
            <strong>Wishlist and product data:</strong> items you save may include product titles, store or
            site names, product page URLs, image URLs, prices, stock, private notes you add per item, group
            comments you post on shared lists, and which list or group they belong to. If you use shared lists,
            group comments and list contents may be visible to people you invite, according to your settings.
          </li>
          <li>
            <strong>Browser extension:</strong> the extension may read information from the active tab (such as
            the page URL and visible product details) when you choose to save an item, so it can send that
            data to your Cart-It account.
          </li>
          <li>
            <strong>Server-side product checks:</strong> to power price and availability updates, our servers may
            retrieve the publicly available HTML of product URLs you have already saved. We may use
            third-party HTTP services (such as ScrapingBee) solely to perform these fetches on our behalf under
            our instructions; they should not use your data for their own unrelated purposes.
          </li>
          <li>
            <strong>Authentication in your browser:</strong> after you log in, a session token may be stored
            in your browser (for example in local storage) so the app can keep you signed in.
          </li>
          <li>
            <strong>Password reset:</strong> if you use &quot;forgot password&quot;, we use your email address
            to send a reset link or code through our email provider.
          </li>
        </ul>

        <h2>How we use information</h2>
        <p>We use the information above to:</p>
        <ul>
          <li>Provide, operate, and improve Cart-It</li>
          <li>Authenticate you and secure your account</li>
          <li>Store and display your saved items and lists</li>
          <li>Send transactional emails related to your account (such as password reset), when applicable</li>
          <li>Detect meaningful product changes (such as price or stock) for items you track, when technically possible</li>
        </ul>

        <h2>Sharing</h2>
        <p>
          We do not sell your personal information. We share data only as needed to run the service—for
          example with hosting and database providers that store our application data, with an email
          delivery provider that sends account-related messages on our behalf, and with fetch services such as
          ScrapingBee when we retrieve public product pages for URLs you saved, as described above. We may also
          disclose information if required by law.
        </p>

        <h2>Security</h2>
        <p>
          We use reasonable technical and organizational measures to protect your information. No method of
          transmission or storage is completely secure; we cannot guarantee absolute security.
        </p>

        <h2>Retention</h2>
        <p>
          We keep your information for as long as your account is active and as needed to provide the
          service. You may request deletion of your account or data by contacting us using the support contact
          shown on our add-on listing or website.
        </p>

        <h2>Children</h2>
        <p>
          Cart-It is not intended for children under 13, and we do not knowingly collect personal information
          from children under 13.
        </p>

        <h2>Changes</h2>
        <p>
          We may update this policy from time to time. We will post the updated version on this page and
          change the &quot;Last updated&quot; date above.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy questions, contact us at supportcartit@gmail.com.
        </p>
      </main>
    </div>
  );
};

export default PrivacyPolicy;
