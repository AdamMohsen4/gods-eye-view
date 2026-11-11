import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { EditableMap } from '@earthnow/shared';
import { api, errorText } from '../api.ts';
import { mapStyle } from '../map/style.ts';
import { pinEl } from '../map/pins.ts';
import { fmt, useTitle } from '../components/ui.tsx';

export function MakerList() {
  useTitle('Map maker');
  const nav = useNavigate();
  const [maps, setMaps] = useState<EditableMap[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.maker.list().then(setMaps).catch(() => setMaps([]));
  }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      const m = await api.maker.create(name);
      nav(`/create/${m.id}`);
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <div className="page narrow">
      <p className="eyebrow">Map maker</p>
      <h1 className="display">Make your own map</h1>
      <p className="lead">Click anywhere on a map and we’ll find the nearest street-level panorama. Publish once you have five or more places, and anyone can play it.</p>
      <form className="panel form row" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Map name, e.g. Swedish lakes" maxLength={60} aria-label="Map name" />
        <button type="submit" className="btn btn-primary" disabled={name.trim().length < 3}>
          Create
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <h2>Your maps</h2>
      {!maps ? (
        <p className="muted">Loading…</p>
      ) : maps.length ? (
        <ul className="maker-list">
          {maps.map((m) => (
            <li key={m.id}>
              <Link to={`/create/${m.id}`}>
                <strong>{m.name}</strong>
                <span className="muted">{fmt(m.locations.length)} places</span>
                <span className={`tag ${m.published ? 'tag-ok' : ''}`}>{m.published ? 'Published' : 'Draft'}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}
    </div>
  );
}

export function MakerEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [map, setMap] = useState<EditableMap | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const el = useRef<HTMLDivElement>(null);
  const gl = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const mapRef = useRef<EditableMap | null>(null);
  mapRef.current = map;
  useTitle(map ? `Editing ${map.name}` : 'Map maker');

  useEffect(() => {
    void api.maker
      .get(id!)
      .then((m) => {
        setMap(m);
        setName(m.name);
        setDesc(m.description);
      })
      .catch((e) => setNote(errorText(e)));
  }, [id]);

  useEffect(() => {
    let m: maplibregl.Map | null = null;
    let cancelled = false;
    void mapStyle().then((style) => {
      if (cancelled) return;
      m = new maplibregl.Map({ container: el.current!, style, center: [10, 30], zoom: 1.2, dragRotate: false, attributionControl: { compact: true } });
      m.touchZoomRotate.disableRotation();
      m.on('click', async (e) => {
        if (!mapRef.current) return;
        setPending((n) => n + 1);
        try {
          const loc = await api.maker.addLocation(mapRef.current.id, { lat: e.lngLat.lat, lon: e.lngLat.wrap().lng });
          setMap((cur) => (cur ? { ...cur, locations: [...cur.locations, loc] } : cur));
          setNote(null);
        } catch (err) {
          setNote(errorText(err));
        } finally {
          setPending((n) => n - 1);
        }
      });
      gl.current = m;
    });
    return () => {
      cancelled = true;
      m?.remove();
      gl.current = null;
      markers.current.clear();
    };
  }, []);

  // Keep markers in sync with the location list.
  useEffect(() => {
    const m = gl.current;
    if (!m || !map) return;
    const ids = new Set(map.locations.map((l) => l.id));
    for (const [k, mk] of markers.current) {
      if (!ids.has(k)) {
        mk.remove();
        markers.current.delete(k);
      }
    }
    for (const l of map.locations) {
      if (markers.current.has(l.id)) continue;
      const elx = pinEl('guess');
      elx.title = 'Remove this place';
      elx.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await api.maker.removeLocation(map.id, l.id);
        setMap((cur) => (cur ? { ...cur, locations: cur.locations.filter((x) => x.id !== l.id) } : cur));
      });
      markers.current.set(l.id, new maplibregl.Marker({ element: elx, anchor: 'bottom' }).setLngLat([l.lon, l.lat]).addTo(m));
    }
  }, [map]);

  async function save(patch: { name?: string; description?: string; published?: boolean }) {
    try {
      const m = await api.maker.update(map!.id, patch);
      setMap((cur) => (cur ? { ...cur, name: m.name, description: m.description, published: m.published } : cur));
      setNote(patch.published === true ? 'Published. It’s now on the community maps page.' : patch.published === false ? 'Unpublished.' : 'Saved.');
    } catch (e) {
      setNote(errorText(e));
    }
  }

  return (
    <div className="maker">
      <div ref={el} className="maker-map" data-testid="maker-map" />
      <aside className="maker-panel">
        <Link to="/create" className="muted small">
          ← Your maps
        </Link>
        {map && (
          <>
            <label className="field">
              <span className="field-label">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== map.name && void save({ name })} maxLength={60} />
            </label>
            <label className="field">
              <span className="field-label">Description</span>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== map.description && void save({ description: desc })} maxLength={280} rows={3} />
            </label>
            <p className="count">
              <strong>{fmt(map.locations.length)}</strong> places {pending > 0 && <span className="muted">· finding panoramas…</span>}
            </p>
            <p className="muted small">Click the map to add a place. Click a pin to remove it.</p>
            <div className="actions">
              {map.published ? (
                <>
                  <Link className="btn btn-primary" to={`/maps/${map.slug}`}>
                    Open map page
                  </Link>
                  <button type="button" className="btn" onClick={() => void save({ published: false })}>
                    Unpublish
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" disabled={map.locations.length < 5} onClick={() => void save({ published: true })}>
                  {map.locations.length < 5 ? `Add ${5 - map.locations.length} more to publish` : 'Publish'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  await api.maker.remove(map.id);
                  nav('/create');
                }}
              >
                Delete map
              </button>
            </div>
          </>
        )}
        {note && (
          <p className="note" role="status">
            {note}
          </p>
        )}
      </aside>
    </div>
  );
}
