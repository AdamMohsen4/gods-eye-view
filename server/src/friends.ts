/**
 * Friends: every player has a short public code. Sending a code asks to be
 * friends; the other player accepts or declines. One row per pair, written
 * by whoever asked first. Deleting a player cascades their rows.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { friendships, users, type Db, type UserRow } from '@earthnow/db';
import { levelFor, type FriendView, type FriendsInfo } from '@earthnow/shared';
import { GameError } from './game.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const MAX_FRIENDS = 200;
const MAX_PENDING_OUT = 50;

function newCode(): string {
  return [...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export class Friends {
  constructor(
    private db: Db,
    private isOnline: (userId: string) => boolean,
  ) {}

  /** The player's friend code, created on first use. */
  async code(user: UserRow): Promise<string> {
    if (user.friendCode) return user.friendCode;
    for (let i = 0; i < 8; i++) {
      const code = newCode();
      const [row] = await this.db
        .update(users)
        .set({ friendCode: code })
        .where(and(eq(users.id, user.id), sql`${users.friendCode} IS NULL`))
        .returning({ code: users.friendCode })
        .catch(() => [] as { code: string | null }[]); // unique clash: try another
      if (row?.code) return row.code;
      const [fresh] = await this.db.select({ code: users.friendCode }).from(users).where(eq(users.id, user.id));
      if (fresh?.code) return fresh.code;
    }
    throw new GameError(500, 'internal');
  }

  async list(user: UserRow): Promise<FriendsInfo> {
    const rows = await this.db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id)));
    const otherIds = rows.map((r) => (r.requesterId === user.id ? r.addresseeId : r.requesterId));
    const people = otherIds.length
      ? await this.db
          .select({ id: users.id, name: users.displayName, country: users.country, xp: users.xp })
          .from(users)
          .where(sql`${users.id} IN (${sql.join(otherIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
      : [];
    const friends: FriendView[] = [];
    for (const r of rows) {
      const otherId = r.requesterId === user.id ? r.addresseeId : r.requesterId;
      const p = people.find((x) => x.id === otherId);
      if (!p) continue;
      const status = r.status === 'accepted' ? 'friend' : r.requesterId === user.id ? 'outgoing' : 'incoming';
      friends.push({ id: p.id, name: p.name, country: p.country, level: levelFor(p.xp).level, online: status === 'friend' && this.isOnline(p.id), status });
    }
    const order = { incoming: 0, friend: 1, outgoing: 2 } as const;
    friends.sort((a, b) => order[a.status] - order[b.status] || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    return { code: await this.code(user), friends };
  }

  /** Ask by code. If they already asked you, this accepts instead. */
  async request(user: UserRow, rawCode: unknown): Promise<FriendsInfo> {
    const code = String(rawCode ?? '')
      .trim()
      .toUpperCase();
    if (!CODE_RE.test(code)) throw new GameError(400, 'invalid_friend_code');
    const [target] = await this.db.select().from(users).where(eq(users.friendCode, code));
    if (!target || target.banned) throw new GameError(404, 'friend_not_found');
    if (target.id === user.id) throw new GameError(400, 'friend_self');
    const existing = await this.pair(user.id, target.id);
    if (existing) {
      if (existing.status === 'pending' && existing.requesterId === target.id) await this.setAccepted(target.id, user.id);
      return this.list(user);
    }
    const [counts] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        out: sql<number>`count(*) FILTER (WHERE ${friendships.requesterId} = ${user.id} AND ${friendships.status} = 'pending')::int`,
      })
      .from(friendships)
      .where(or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id)));
    if (Number(counts?.total ?? 0) >= MAX_FRIENDS) throw new GameError(409, 'too_many_friends');
    if (Number(counts?.out ?? 0) >= MAX_PENDING_OUT) throw new GameError(409, 'too_many_requests');
    await this.db.insert(friendships).values({ requesterId: user.id, addresseeId: target.id }).onConflictDoNothing();
    return this.list(user);
  }

  async accept(user: UserRow, otherId: string): Promise<FriendsInfo> {
    const p = await this.pair(user.id, otherId);
    if (!p || p.requesterId !== otherId || p.status !== 'pending') throw new GameError(404, 'friend_request_not_found');
    await this.setAccepted(otherId, user.id);
    return this.list(user);
  }

  /** Unfriend, decline, or cancel a request: all remove the pair. */
  async remove(user: UserRow, otherId: string): Promise<FriendsInfo> {
    await this.db
      .delete(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, otherId)),
          and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, user.id)),
        ),
      );
    return this.list(user);
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const p = await this.pair(a, b);
    return p?.status === 'accepted';
  }

  private async pair(a: string, b: string) {
    const [row] = await this.db
      .select()
      .from(friendships)
      .where(
        or(and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)), and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a))),
      );
    return row;
  }

  private async setAccepted(requesterId: string, addresseeId: string): Promise<void> {
    await this.db
      .update(friendships)
      .set({ status: 'accepted' })
      .where(and(eq(friendships.requesterId, requesterId), eq(friendships.addresseeId, addresseeId)));
  }
}
