// SQLite does not support Prisma enums; we use string literals and this const for type safety.
export const Role = { ADMIN: "ADMIN", ARTIST: "ARTIST", USER: "USER" } as const;
export type Role = (typeof Role)[keyof typeof Role];
