/**
 * Community maps: a player drops points on a map, each is snapped to the
 * nearest panorama of the active provider, and the map is published once it
 * has enough places.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { locations, maps, rowsOf, type Db, type MapRow, type UserRow } from '@earthnow/db';
import { isLatLon, type EditableMap } from '@earthnow/shared';
import type { Config } from './config.ts';
import { countryAt } from './countries.ts';
import { GameError } from './game.ts';
import { ImageryError, imageryProvider } from './imagery/index.ts';

export const MIN_LOCATIONS_TO_PUBLISH = 5;
export const MAX_LOCATIONS = 2000;
const MAX_DRAFTS = 20;

function clean(s: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex -- strip control characters
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'map';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export class MapMaker {
  constructor(
    private db: Db,
    private config: Config,
  ) {}

  private async own(user: UserRow, mapId: string): Promise<MapRow> {
    const [m] = await this.db.select().from(maps).where(eq(maps.id, mapId));
    if (!m || m.creatorId !== user.id || m.kind !== 'community') throw new GameError(404, 'map_not_found');
    return m;
  }

  async mine(user: UserRow): Promise<EditableMap[]> {
    const rows = await this.db.select().from(maps).where(eq(maps.creatorId, user.id)).orderBy(asc(maps.createdAt));
    return Promise.all(rows.map((m) => this.editable(m)));
  }

  async editable(m: MapRow): Promise<EditableMap> {
    const locs = await this.db
      .select({ id: locations.id, lat: locations.lat, lon: locations.lon, country: locations.country })
      .from(locations)
      .where(and(eq(locations.mapId, m.id), eq(locations.provider, this.config.provider), eq(locations.disabled, false)))
      .orderBy(asc(locations.createdAt));
    return { id: m.id, slug: m.slug, name: m.name, description: m.description, published: m.published, locations: locs };
  }

  async get(user: UserRow, mapId: string): Promise<EditableMap> {
    return this.editable(await this.own(user, mapId));
  }

  async create(user: UserRow, body: { name?: unknown; description?: unknown }): Promise<EditableMap> {
    const name = clean(body.name, 60);
    if (name.length < 3) throw new GameError(400, 'invalid_name');
    const [c] = rowsOf<{ n: number }>(await this.db.execute(sql`SELECT count(*)::int AS n FROM maps WHERE creator_id = ${user.id}`));
    if ((c?.n ?? 0) >= MAX_DRAFTS) throw new GameError(409, 'too_many_maps');
    const [m] = await this.db
      .insert(maps)
      .values({ slug: slugify(name), name, description: clean(body.description, 280), kind: 'community', creatorId: user.id, published: false })
      .returning();
    return this.editable(m!);
  }

  async update(user: UserRow, mapId: string, body: { name?: unknown; description?: unknown; published?: unknown }): Promise<EditableMap> {
    const m = await this.own(user, mapId);
    const set: Partial<MapRow> = {};
    if (body.name !== undefined) {
      const name = clean(body.name, 60);
      if (name.length < 3) throw new GameError(400, 'invalid_name');
      set.name = name;
    }
    if (body.description !== undefined) set.description = clean(body.description, 280);
    if (body.published !== undefined) {
      const publish = body.published === true;
      if (publish) {
        const [c] = rowsOf<{ n: number }>(
          await this.db.execute(sql`SELECT count(*)::int AS n FROM locations WHERE map_id = ${m.id} AND provider = ${this.config.provider} AND NOT disabled`),
        );
        if ((c?.n ?? 0) < MIN_LOCATIONS_TO_PUBLISH) throw new GameError(409, 'too_few_locations', { min: MIN_LOCATIONS_TO_PUBLISH });
      }
      set.published = publish;
    }
    if (Object.keys(set).length) await this.db.update(maps).set(set).where(eq(maps.id, m.id));
    return this.get(user, mapId);
  }

  async remove(user: UserRow, mapId: string): Promise<void> {
    const m = await this.own(user, mapId);
    await this.db.delete(maps).where(eq(maps.id, m.id));
  }

  /** Snap a dropped point to the nearest panorama and add it. */
  async addLocation(user: UserRow, mapId: string, raw: unknown): Promise<EditableMap['locations'][number]> {
    const m = await this.own(user, mapId);
    if (!isLatLon(raw)) throw new GameError(400, 'invalid_point');
    const [c] = rowsOf<{ n: number }>(await this.db.execute(sql`SELECT count(*)::int AS n FROM locations WHERE map_id = ${m.id}`));
    if ((c?.n ?? 0) >= MAX_LOCATIONS) throw new GameError(409, 'map_full');
    const provider = imageryProvider(this.config.provider, this.config);
    const found = await provider.findPano({ lat: raw.lat, lon: raw.lon }, 1000).catch((e: unknown) => {
      // A provider outage is not "no coverage here".
      if (e instanceof ImageryError) {
        console.error('[maker]', e.message);
        throw new GameError(503, 'imagery_unavailable');
      }
      throw e;
    });
    if (!found) throw new GameError(422, 'no_coverage');
    const [row] = await this.db
      .insert(locations)
      .values({
        mapId: m.id,
        provider: provider.id,
        panoId: found.panoId,
        lat: found.lat,
        lon: found.lon,
        heading: found.heading ?? Math.round(Math.random() * 360),
        country: countryAt(found),
        credit: found.credit,
      })
      .onConflictDoNothing()
      .returning({ id: locations.id, lat: locations.lat, lon: locations.lon, country: locations.country });
    if (!row) throw new GameError(409, 'duplicate_location');
    return row;
  }

  async removeLocation(user: UserRow, mapId: string, locationId: string): Promise<void> {
    const m = await this.own(user, mapId);
    // Locations already played stay referenced by old rounds; disable instead of delete.
    await this.db.update(locations).set({ disabled: true }).where(and(eq(locations.id, locationId), eq(locations.mapId, m.id)));
    await this.db.delete(locations).where(
      and(eq(locations.id, locationId), eq(locations.mapId, m.id), sql`NOT EXISTS (SELECT 1 FROM game_rounds WHERE location_id = ${locationId})`),
    );
  }
}
