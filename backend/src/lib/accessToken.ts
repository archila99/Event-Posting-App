import jwt, { type SignOptions } from "jsonwebtoken";

export function getAccessTokenSecret(): string {
  return (
    process.env.JWT_ACCESS_SECRET ||
    process.env.ACCESS_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    "secret"
  );
}

export function getAccessTokenExpiresIn(): SignOptions["expiresIn"] {
  return (process.env.ACCESS_TOKEN_EXPIRES_IN || "15m") as SignOptions["expiresIn"];
}

export function signAccessToken(payload: { userId: string; email: string; role: string }): string {
  return jwt.sign(payload, getAccessTokenSecret(), { expiresIn: getAccessTokenExpiresIn() });
}
