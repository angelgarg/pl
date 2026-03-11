/**
 * adminTracking.js
 *
 * Runs after every new user registration:
 *  1. Sends an admin notification email to EMAIL_ADMIN (or EMAIL_USER)
 *  2. Appends a row to a Google Sheet with full stats
 *
 * Required env vars:
 *   EMAIL_USER                  — Gmail address used to send
 *   EMAIL_APP_PASSWORD          — Gmail App Password
 *   EMAIL_ADMIN                 — admin inbox (defaults to EMAIL_USER)
 *   GOOGLE_SERVICE_ACCOUNT_JSON — full JSON content of service-account key file
 *   GOOGLE_SHEET_ID             — the spreadsheet ID from its URL
 */

'use strict';

const nodemailer = require('nodemailer');
const db         = require('./db');

// ─── Email transporter (lazy-init, same pattern as forgot-password) ─────────
let _transport = null;
function getTransport() {
  if (_transport) return _transport;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) return null;
  _transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  return _transport;
}

// ─── Google Sheets helper (lazy-init) ───────────────────────────────────────
let _sheetsAuth = null;

async function getSheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_SHEET_ID) return null;
  try {
    const { google } = require('googleapis');
    if (!_sheetsAuth) {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      _sheetsAuth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
    }
    const authClient = await _sheetsAuth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
  } catch (e) {
    console.error('[TRACKING] Sheets init error:', e.message);
    return null;
  }
}

// ─── Ensure header row exists ────────────────────────────────────────────────
async function ensureHeaders(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A1:H1'
    });
    const firstRow = res.data.values?.[0];
    if (!firstRow || firstRow.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'S.No.', 'Date & Time', 'Username', 'Email / Phone',
            'Auth Method', 'Total Users', 'Total Devices', 'Account Type'
          ]]
        }
      });

      // Bold + freeze header row
      const sheetId = await getFirstSheetId(sheets, spreadsheetId);
      if (sheetId !== null) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                  cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.22, green: 0.56, blue: 0.24 } } },
                  fields: 'userEnteredFormat(textFormat,backgroundColor)'
                }
              },
              { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }
            ]
          }
        });
      }
    }
  } catch (e) {
    console.error('[TRACKING] ensureHeaders error:', e.message);
  }
}

async function getFirstSheetId(sheets, spreadsheetId) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    return meta.data.sheets?.[0]?.properties?.sheetId ?? null;
  } catch { return null; }
}

// ─── Count existing data rows ─────────────────────────────────────────────────
async function getNextRowNumber(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:A'
    });
    const rows = res.data.values || [];
    // rows[0] is header, subsequent rows are data
    return Math.max(rows.length - 1, 0) + 1; // next S.No.
  } catch { return 1; }
}

// ─── Main tracking function ───────────────────────────────────────────────────
/**
 * @param {object} newUser   — the user object just created
 * @param {string} method    — 'email' | 'google' | 'phone'
 * @param {boolean} isNew    — true if this is a brand-new account (not just a login)
 */
async function trackNewRegistration(newUser, method = 'email', isNew = true) {
  if (!isNew) return; // skip logins; only track first-time registrations

  const allUsers   = db.getUsers().filter(u => !u.isGuest);
  const allDevices = db.getDevices();
  const totalUsers   = allUsers.length;
  const totalDevices = allDevices.length;

  const displayContact = newUser.phone
    ? newUser.phone
    : (newUser.email?.endsWith('@phone.bhoomiq') ? newUser.phone || newUser.username : newUser.email);

  const accountType = newUser.isGuest ? 'Guest' : 'Full Account';
  const dateStr     = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

  // ── 1. Send admin email ──────────────────────────────────────────────────
  sendAdminEmail({ newUser, method, totalUsers, totalDevices, allUsers, allDevices, dateStr, displayContact });

  // ── 2. Update Google Sheet ───────────────────────────────────────────────
  appendToSheet({ newUser, method, totalUsers, totalDevices, dateStr, displayContact, accountType });
}

// ─── Send admin notification email ───────────────────────────────────────────
async function sendAdminEmail({ newUser, method, totalUsers, totalDevices, allUsers, allDevices, dateStr, displayContact }) {
  const transport = getTransport();
  if (!transport) return;

  const adminEmail = process.env.EMAIL_ADMIN || process.env.EMAIL_USER;
  if (!adminEmail) return;

  // Build a mini user table for the email (last 10 users)
  const recentUsers = [...allUsers].reverse().slice(0, 10);
  const userRows = recentUsers.map(u => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e8f5e9;">${u.username}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e8f5e9;">${u.email || u.phone || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e8f5e9;text-transform:capitalize;">${u.auth_provider || 'email'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e8f5e9;">${new Date(u.created_at).toLocaleDateString('en-IN')}</td>
    </tr>`).join('');

  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f1f8e9;font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#388e3c,#66bb6a);padding:28px 32px;">
        <h1 style="margin:0;color:#fff;font-size:22px;">🌱 BhoomiIQ — New User Registered</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${dateStr} (IST)</p>
      </div>

      <!-- New user card -->
      <div style="padding:28px 32px 0;">
        <h2 style="margin:0 0 16px;color:#2e7d32;font-size:16px;">👤 New Account Details</h2>
        <table style="width:100%;border-collapse:collapse;background:#f9fbe7;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 16px;color:#555;width:40%;">Username</td><td style="padding:10px 16px;font-weight:700;color:#1b5e20;">${newUser.username}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px 16px;color:#555;">Email / Phone</td><td style="padding:10px 16px;font-weight:700;color:#1b5e20;">${displayContact}</td></tr>
          <tr><td style="padding:10px 16px;color:#555;">Auth Method</td><td style="padding:10px 16px;font-weight:700;color:#1b5e20;text-transform:capitalize;">${method}</td></tr>
        </table>
      </div>

      <!-- Stats row -->
      <div style="padding:24px 32px 0;display:flex;gap:16px;">
        <div style="flex:1;background:#e8f5e9;border-radius:10px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#388e3c;">${totalUsers}</div>
          <div style="font-size:12px;color:#555;margin-top:4px;">Total Users</div>
        </div>
        <div style="flex:1;background:#f3e5f5;border-radius:10px;padding:18px;text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#7b1fa2;">${totalDevices}</div>
          <div style="font-size:12px;color:#555;margin-top:4px;">Total Devices</div>
        </div>
      </div>

      <!-- Recent users table -->
      <div style="padding:24px 32px 32px;">
        <h2 style="margin:0 0 12px;color:#2e7d32;font-size:15px;">📋 Recent Users (last 10)</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#e8f5e9;">
              <th style="padding:8px 12px;text-align:left;color:#2e7d32;">Username</th>
              <th style="padding:8px 12px;text-align:left;color:#2e7d32;">Email / Phone</th>
              <th style="padding:8px 12px;text-align:left;color:#2e7d32;">Method</th>
              <th style="padding:8px 12px;text-align:left;color:#2e7d32;">Joined</th>
            </tr>
          </thead>
          <tbody>${userRows}</tbody>
        </table>
      </div>

      <div style="background:#f9fbe7;padding:16px 32px;text-align:center;font-size:11px;color:#888;">
        BhoomiIQ Admin Notifications • gargangel2233@gmail.com
      </div>
    </div>
  </body>
  </html>`;

  try {
    await transport.sendMail({
      from:    `"BhoomiIQ Admin" <${process.env.EMAIL_USER}>`,
      to:      adminEmail,
      subject: `🌱 New Registration: ${newUser.username} (via ${method}) — ${totalUsers} total users`,
      html
    });
    console.log(`[TRACKING] Admin email sent for new user: ${newUser.username}`);
  } catch (e) {
    console.error('[TRACKING] Admin email error:', e.message);
  }
}

// ─── Append row to Google Sheet ───────────────────────────────────────────────
async function appendToSheet({ newUser, method, totalUsers, totalDevices, dateStr, displayContact, accountType }) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;

  const sheets = await getSheetsClient();
  if (!sheets) return;

  try {
    await ensureHeaders(sheets, spreadsheetId);
    const sno = await getNextRowNumber(sheets, spreadsheetId);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:H',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          sno,
          dateStr,
          newUser.username,
          displayContact || '—',
          method.charAt(0).toUpperCase() + method.slice(1),
          totalUsers,
          totalDevices,
          accountType
        ]]
      }
    });
    console.log(`[TRACKING] Sheet row appended: #${sno} ${newUser.username}`);
  } catch (e) {
    console.error('[TRACKING] Sheet append error:', e.message);
  }
}

module.exports = { trackNewRegistration };
