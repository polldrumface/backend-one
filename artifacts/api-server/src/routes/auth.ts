import { Router } from "express";
import crypto from "crypto";
import { sendApprovalRequest, getPendingStatus } from "../lib/discord-bot.js";
import { db } from "@workspace/db";
import { approvedUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;

function getRedirectUri(req: any): string {
  const host = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : `http://localhost:${process.env.PORT || 5000}`;
  return `${host}/api/auth/discord/callback`;
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || "http://localhost:3000";
}

router.get("/discord", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get("/discord/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect(`${getFrontendUrl()}/?error=invalid_state`);
  }

  delete req.session.oauthState;

  try {
    const redirectUri = getRedirectUri(req);

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      req.log.error({ err }, "Discord token exchange failed");
      return res.redirect(`${getFrontendUrl()}/?error=token_failed`);
    }

    const tokenData = await tokenRes.json() as { access_token: string };

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return res.redirect(`${getFrontendUrl()}/?error=user_fetch_failed`);
    }

    const discordUser = await userRes.json() as {
      id: string;
      username: string;
      discriminator: string;
      avatar: string | null;
    };

    // Check if user was previously approved
    const existing = await db.select()
      .from(approvedUsersTable)
      .where(eq(approvedUsersTable.discordId, discordUser.id))
      .limit(1);

    if (existing.length > 0 && existing[0].approved) {
      req.session.user = {
        userId: discordUser.id,
        username: discordUser.username,
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar,
        approved: true,
        approvalStatus: "approved",
      };
      await req.session.save();
      return res.redirect(`${getFrontendUrl()}/app`);
    }

    const approvalToken = crypto.randomBytes(32).toString("hex");

    req.session.user = {
      userId: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
      approved: false,
      approvalToken,
      approvalStatus: "pending",
    };
    req.session.approvalToken = approvalToken;

    await req.session.save();

    await db.insert(approvedUsersTable)
      .values({
        discordId: discordUser.id,
        username: discordUser.username,
        discriminator: discordUser.discriminator,
        avatar: discordUser.avatar,
        approved: false,
      })
      .onConflictDoUpdate({
        target: approvedUsersTable.discordId,
        set: {
          username: discordUser.username,
          discriminator: discordUser.discriminator,
          avatar: discordUser.avatar,
        },
      });

    sendApprovalRequest(approvalToken, {
      id: discordUser.id,
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      avatar: discordUser.avatar,
    }).then(async (status) => {
      if (status === "approved") {
        await db.update(approvedUsersTable)
          .set({ approved: true, approvedAt: new Date() })
          .where(eq(approvedUsersTable.discordId, discordUser.id));
      }
      if (req.session.user && req.session.user.approvalToken === approvalToken) {
        req.session.user.approvalStatus = status;
        req.session.user.approved = status === "approved";
        req.session.save();
      }
    });

    return res.redirect(`${getFrontendUrl()}/pending?token=${approvalToken}`);
  } catch (err) {
    req.log.error({ err }, "Discord callback error");
    return res.redirect(`${getFrontendUrl()}/?error=server_error`);
  }
});

router.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const u = req.session.user;
  return res.json({
    id: u.userId,
    username: u.username,
    discriminator: u.discriminator,
    avatar: u.avatar,
    approved: u.approved,
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/status", (req, res) => {
  const { token } = req.query as { token?: string };

  if (!token) {
    return res.status(400).json({ status: "pending", message: null });
  }

  const sessionUser = req.session.user;
  if (sessionUser && sessionUser.approvalToken === token) {
    return res.json({
      status: sessionUser.approvalStatus || "pending",
      message: null,
    });
  }

  const liveStatus = getPendingStatus(token);
  if (liveStatus) {
    return res.json({ status: liveStatus, message: null });
  }

  return res.json({ status: "rejected", message: null });
});

export default router;
