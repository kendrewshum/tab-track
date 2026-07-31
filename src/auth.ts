import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { db } from "@/db";
import { createAuthAttemptStore } from "@/lib/server/auth-attempt-store";
import { createAuthRateLimiter } from "@/lib/server/auth-rate-limit";
import { getTrustedRequestSource } from "@/lib/server/auth-request-source";
import { authorizeCredentialsAttempt } from "@/lib/server/credentials-authorize";
import { verifyPassword } from "@/lib/password";
import { findUserByEmail, syncLegacyGroupAccessForAppUser } from "@/lib/server/users";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const secret = process.env.AUTH_SECRET;
        if (!secret) {
          return null;
        }

        return authorizeCredentialsAttempt(
          {
            credentials,
            source: await getTrustedRequestSource(),
          },
          {
            limiter: createAuthRateLimiter({
              store: createAuthAttemptStore(db),
              secret,
            }),
            findUserByEmail,
            verifyPassword,
            syncLegacyAccess: syncLegacyGroupAccessForAppUser,
          },
        );
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id =
          typeof token.id === "string"
            ? token.id
            : typeof token.sub === "string"
            ? token.sub
            : "";
        session.user.name =
          typeof token.name === "string" ? token.name : session.user.name ?? null;
        session.user.email =
          typeof token.email === "string" ? token.email : session.user.email ?? "";
      }

      return session;
    },
  },
});
