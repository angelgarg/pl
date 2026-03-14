# BhoomiIQ — Social Media Auto-Poster Setup Guide

The auto-poster is already built into the backend. You just need to get 4 values
and add them to Render's environment variables.

---

## What gets posted automatically

Every day at 9 AM IST, the backend will:
1. Generate fresh content via Gemini AI (plant tips, farming facts, seasonal advice, etc.)
2. Post a text update to your **Facebook Page**
3. Post an image + caption to your **Instagram Business Account**

---

## Step 1 — Facebook Page

You need a Facebook Page (not a personal profile).

1. Go to https://www.facebook.com/pages/create
2. Create a page named **BhoomiIQ** (or use existing)
3. Note your **Page ID** — go to your Page → About → scroll to bottom → Page ID (a long number like `123456789012345`)

---

## Step 2 — Get Facebook Page Access Token

This is the most important step. The token lets the app post on your behalf.

1. Go to https://developers.facebook.com
2. Click **My Apps** → **Create App** → choose **Business** type
3. App name: `BhoomiIQ Poster` → Create
4. In the app dashboard, go to **Tools** → **Graph API Explorer**
5. Top right: select your app
6. Click **Generate Access Token** → login with your Facebook account
7. Under **Permissions**, add:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
8. Click **Generate Access Token** again
9. Copy the token — this is a **short-lived token** (expires in 1 hour)

**Convert to long-lived token (never expires):**

Run this in your browser or Postman:
```
GET https://graph.facebook.com/v19.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=YOUR_APP_ID
  &client_secret=YOUR_APP_SECRET
  &fb_exchange_token=YOUR_SHORT_LIVED_TOKEN
```

You'll get a long-lived user token. Then exchange it for a **Page Access Token**:
```
GET https://graph.facebook.com/v19.0/me/accounts
  ?access_token=YOUR_LONG_LIVED_USER_TOKEN
```

From the response, find your page and copy its `access_token` — this is your **permanent Page Access Token**.

---

## Step 3 — Instagram Business Account

Instagram posting requires your account to be a **Business** or **Creator** account
linked to your Facebook Page.

1. Open Instagram app → Profile → Settings → Account → **Switch to Professional Account**
2. Choose **Business** → Link to your Facebook Page
3. Go to https://developers.facebook.com/tools/explorer
4. Run:
   ```
   GET /me/accounts?fields=instagram_business_account
   ```
   with your Page Access Token
5. From the response, copy the `instagram_business_account.id` — this is your **IG_USER_ID**

---

## Step 4 — Instagram Default Image

Instagram requires an image for every post. Upload one public BhoomiIQ image:

Option A — Upload to Imgur:
1. Go to https://imgur.com → drag your BhoomiIQ logo/banner image
2. Right-click the image → Copy image address
3. That URL is your `IG_IMAGE_URL`

Option B — Use your Render backend (if you have a public image in your repo):
- Add your image to `backend/public/` folder
- URL becomes: `https://pl-kp57.onrender.com/bhoomiiq-banner.jpg`

---

## Step 5 — Add to Render Environment Variables

Go to your Render dashboard → your backend service → **Environment**

Add these variables:

| Key | Value | Example |
|-----|-------|---------|
| `FB_PAGE_ID` | Your Facebook Page ID | `123456789012345` |
| `FB_PAGE_ACCESS_TOKEN` | Long-lived Page Access Token | `EAABx...` |
| `IG_USER_ID` | Instagram Business Account ID | `17841234567890` |
| `IG_IMAGE_URL` | Public image URL for Instagram posts | `https://i.imgur.com/abc.jpg` |
| `POST_TIME` | Cron schedule (optional) | `0 9 * * *` (9 AM daily) |
| `SOCIAL_API_KEY` | Secret key for manual trigger | `any-secret-string` |

---

## Step 6 — Test it manually

Once env vars are set, trigger a test post via this API call:

```bash
curl -X POST "https://pl-kp57.onrender.com/api/social/post-now?force=true&key=YOUR_SOCIAL_API_KEY"
```

You should see a response like:
```json
{
  "date": "Fri Mar 13 2026",
  "post_type": "plant_care_tip",
  "facebook":  { "success": true, "postId": "123456_789" },
  "instagram": { "success": true, "mediaId": "17854321" }
}
```

Check your Facebook Page and Instagram — the post should be live!

---

## Check scheduler status

```bash
curl "https://pl-kp57.onrender.com/api/social/status?key=YOUR_SOCIAL_API_KEY"
```

Response:
```json
{
  "today": "Fri Mar 13 2026",
  "schedule": "0 9 * * *",
  "facebook_ready": true,
  "instagram_ready": true
}
```

---

## Posting schedule

| Platform | Time | Content |
|----------|------|---------|
| Facebook | 9:00 AM IST daily | Text post with caption + hashtags |
| Instagram | 9:00 AM IST daily | Image + caption + hashtags |

Content rotates through 7 types weekly:
- Monday: Plant care tip
- Tuesday: IoT farming fact
- Wednesday: Seasonal farming advice
- Thursday: BhoomiIQ product feature
- Friday: Motivational farmer quote
- Saturday: Water saving tip
- Sunday: Soil health tip

---

## Troubleshooting

**Facebook post fails with `OAuthException`:**
→ Your Page Access Token expired. Regenerate a long-lived token (Step 2).

**Instagram container fails with `invalid image`:**
→ Your `IG_IMAGE_URL` is not publicly accessible or not a valid JPEG/PNG.

**Posts not happening at scheduled time:**
→ Render free tier sleeps. The scheduler only runs when the server is awake.
→ Solution: Use Render's paid tier, OR set up an external cron (e.g. cron-job.org)
   to ping your backend at 9 AM and add `POST /api/social/post-now?force=true` as the URL.
