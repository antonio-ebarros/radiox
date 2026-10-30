import os, re, hashlib, hmac, secrets, sqlite3, threading, time, unicodedata
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

MUSIC = os.environ.get("MUSIC_DIR", "/musica")
DATA = os.environ.get("DATA_DIR", "/data")
AUDIO = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav"}
IMG = (".jpg", ".jpeg", ".png", ".webp")
MIME = {".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
        ".opus": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav"}
NUM = re.compile(r"^\s*(?:\d{1,3}\s*[-._)]+\s*|0\d\s+)")
lock = threading.Lock()
app = FastAPI()
os.makedirs(DATA, exist_ok=True)


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").casefold()) if unicodedata.category(c) != "Mn")

def nat(s):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", s.casefold())]

def sid(s):
    return hashlib.sha1(s.encode()).hexdigest()[:12]

def rel(p):
    return os.path.relpath(p, MUSIC)

def db():
    c = sqlite3.connect(os.path.join(DATA, "radiox.db"))
    c.row_factory = sqlite3.Row
    c.create_function("fold", 1, fold)
    return c

def ls(p):
    try:
        return sorted((e for e in os.scandir(p) if not e.name.startswith(".")), key=lambda e: nat(e.name))
    except OSError:
        return []

def image(ents, names):
    f = {os.path.splitext(e.name)[0].casefold(): e.name for e in ents if e.is_file() and e.name.lower().endswith(IMG)}
    return next((f[n] for n in names if n in f), None)

def audio(p):
    out = []
    for root, dirs, files in os.walk(p):
        dirs[:] = sorted((d for d in dirs if not d.startswith(".")), key=nat)
        out += [os.path.join(root, f) for f in sorted(files, key=nat)
                if not f.startswith(".") and os.path.splitext(f)[1].lower() in AUDIO]
    return out

def picture(path):
    try:
        import base64, mutagen
        from mutagen.flac import Picture
        f = mutagen.File(path)
        if f is None:
            return None
        if getattr(f, "pictures", None):
            return f.pictures[0].data
        t = f.tags
        if t is None:
            return None
        if hasattr(t, "getall") and t.getall("APIC"):
            return t.getall("APIC")[0].data
        if "covr" in t:
            return bytes(t["covr"][0])
        if "metadata_block_picture" in t:
            return Picture(base64.b64decode(t["metadata_block_picture"][0])).data
    except Exception:
        pass
    return None

def embedded_cover(bid, track):
    d = os.path.join(DATA, "covers")
    os.makedirs(d, exist_ok=True)
    for e in ("jpg", "png", "webp"):
        p = os.path.join(d, f"{bid}.{e}")
        if os.path.isfile(p) and os.path.getmtime(p) >= os.path.getmtime(track):
            return f"@{bid}.{e}"
    b = picture(track)
    if not b:
        return None
    e = "jpg" if b[:3] == b"\xff\xd8\xff" else "png" if b[:8] == b"\x89PNG\r\n\x1a\n" else "webp" if b[:4] == b"RIFF" and b[8:12] == b"WEBP" else None
    if not e:
        return None
    with open(os.path.join(d, f"{bid}.{e}"), "wb") as f:
        f.write(b)
    return f"@{bid}.{e}"

def rescan():
    with lock:
        A, B, T = [], [], []
        for i, a in enumerate(e for e in ls(MUSIC) if e.is_dir()):
            ents = ls(a.path)
            aimg = image(ents, ("artist", "cover", "folder", "front", "capa"))
            groups = [(e.name, e.path, False, audio(e.path), image(ls(e.path), ("cover", "folder", "front", "capa", "album")))
                      for e in ents if e.is_dir()]
            loose = [e.path for e in ents if e.is_file() and os.path.splitext(e.name)[1].lower() in AUDIO]
            if loose:
                groups.append(("singles", a.path, True, loose, aimg))
            aid, first, n = sid(rel(a.path)), None, 0
            ap, allp = os.path.exists(os.path.join(a.path, ".privado")), True
            for j, (name, path, single, files, cov) in enumerate(g for g in groups if g[3]):
                bid = sid(rel(path) + ("#s" if single else ""))
                cp = rel(os.path.join(path, cov)) if cov else (None if single else next((c for c in (embedded_cover(bid, f) for f in files[:3]) if c), None))
                bp = int(ap or (not single and os.path.exists(os.path.join(path, ".privado"))))
                allp = allp and bp
                first = first or (None if bp else cp)
                B.append((bid, aid, name, cp, j, bp))
                for k, f in enumerate(files):
                    stem, ext = os.path.splitext(os.path.basename(f))
                    T.append((sid(rel(f)), bid, NUM.sub("", stem) or stem, rel(f), ext.lower(), k))
                    n += 1
            if n:
                A.append((aid, a.name, rel(os.path.join(a.path, aimg)) if aimg else first, i, int(ap or allp)))
        c = db()
        with c:
            c.executescript("""BEGIN; DROP TABLE IF EXISTS artists; DROP TABLE IF EXISTS albums; DROP TABLE IF EXISTS tracks;
            CREATE TABLE artists(id TEXT PRIMARY KEY,name,cover,sort,priv);
            CREATE TABLE albums(id TEXT PRIMARY KEY,artist_id,name,cover,pos,priv);
            CREATE TABLE tracks(id TEXT PRIMARY KEY,album_id,title,path,ext,pos);""")
            c.executemany("INSERT OR REPLACE INTO artists VALUES(?,?,?,?,?)", A)
            c.executemany("INSERT OR REPLACE INTO albums VALUES(?,?,?,?,?,?)", B)
            c.executemany("INSERT OR REPLACE INTO tracks VALUES(?,?,?,?,?,?)", T)
        c.close()
        return {"artists": len(A), "albums": len(B), "tracks": len(T)}

AUTO_SCAN = int(os.environ.get("AUTO_SCAN_SECONDS", "60"))


def signature():
    """Impressão digital barata: só pastas (nome + data de modificação).
    Arquivo novo, removido, renomeado ou .privado mudam a data da pasta."""
    h = hashlib.sha1()
    stack = [MUSIC]
    while stack:
        p = stack.pop()
        try:
            h.update(f"{p}|{os.stat(p).st_mtime_ns}".encode())
            stack.extend(e.path for e in os.scandir(p) if e.is_dir(follow_symlinks=False))
        except OSError:
            pass
    return h.hexdigest()


def watcher(last):
    while True:
        time.sleep(AUTO_SCAN)
        try:
            now = signature()
            if now != last:
                last = now
                print("pastas mudaram, atualizando biblioteca...", flush=True)
                rescan()
        except Exception as e:
            print("falha na atualização automática:", e, flush=True)


@app.on_event("startup")
def startup():
    init_pl()
    sig = signature()
    rescan()
    if AUTO_SCAN > 0:
        threading.Thread(target=watcher, args=(sig,), daemon=True).start()

TRACKS = """SELECT t.id,t.title,t.ext,t.album_id,al.name AS album,al.cover IS NOT NULL AS cov,
ar.id AS artist_id,ar.name AS artist,al.priv AS priv FROM tracks t JOIN albums al ON al.id=t.album_id
JOIN artists ar ON ar.id=al.artist_id """

def rows(sql, *a):
    c = db()
    try:
        return [dict(r) for r in c.execute(sql, a)]
    finally:
        c.close()

class Pin(BaseModel):
    pin: str

PIN_FILE = os.path.join(DATA, "pin.txt")
SESS, FAILS = set(), []

def unlocked(r: Request):
    return r.cookies.get("rx_s") in SESS

@app.get("/api/state")
def state(request: Request):
    return {"open": unlocked(request)}

@app.post("/api/unlock")
def unlock(b: Pin, response: Response):
    now = time.time()
    FAILS[:] = [t for t in FAILS if now - t < 60]
    if len(FAILS) >= 5:
        raise HTTPException(429)
    try:
        pin = open(PIN_FILE).read().strip()
    except OSError:
        raise HTTPException(404)
    if not pin or not hmac.compare_digest(b.pin.strip().encode(), pin.encode()):
        FAILS.append(now)
        raise HTTPException(403)
    tok = secrets.token_urlsafe(24)
    SESS.add(tok)
    response.set_cookie("rx_s", tok, httponly=True, samesite="lax", max_age=43200)
    return {}

@app.post("/api/lock")
def relock(request: Request, response: Response):
    SESS.discard(request.cookies.get("rx_s"))
    response.delete_cookie("rx_s")
    return {}

@app.get("/api/artists")
def artists(request: Request):
    v = unlocked(request)
    return rows("SELECT id,name,priv,cover IS NOT NULL AS cov,(SELECT COUNT(*) FROM albums WHERE artist_id=artists.id"
                + ("" if v else " AND priv=0") + ") AS albums FROM artists " + ("" if v else "WHERE priv=0 ") + "ORDER BY sort")

@app.get("/api/artists/{id}")
def artist(id: str, request: Request):
    v = unlocked(request)
    a = rows("SELECT id,name,priv FROM artists WHERE id=?", id)
    if not a or (a[0]["priv"] and not v):
        raise HTTPException(404)
    a[0]["albums"] = rows("SELECT id,name,priv,cover IS NOT NULL AS cov,(SELECT COUNT(*) FROM tracks WHERE album_id=albums.id) AS tracks FROM albums WHERE artist_id=?"
                          + ("" if v else " AND priv=0") + " ORDER BY pos", id)
    return a[0]

@app.get("/api/albums/{id}")
def album(id: str, request: Request):
    a = rows("SELECT al.id,al.name,al.priv,al.cover IS NOT NULL AS cov,ar.id AS artist_id,ar.name AS artist FROM albums al JOIN artists ar ON ar.id=al.artist_id WHERE al.id=?", id)
    if not a or (a[0]["priv"] and not unlocked(request)):
        raise HTTPException(404)
    a[0]["tracks"] = rows(TRACKS + "WHERE t.album_id=? ORDER BY t.pos", id)
    return a[0]

@app.get("/api/search")
def search(request: Request, q: str = ""):
    k = "%" + fold(q).replace("%", "").replace("_", "") + "%"
    f = "" if unlocked(request) else " AND {}.priv=0"
    return {"artists": rows("SELECT id,name,cover IS NOT NULL AS cov,0 AS albums FROM artists WHERE fold(name) LIKE ?" + f.format("artists") + " ORDER BY sort LIMIT 30", k),
            "albums": rows("SELECT id,name,cover IS NOT NULL AS cov,0 AS tracks FROM albums WHERE fold(name) LIKE ?" + f.format("albums") + " LIMIT 30", k),
            "tracks": rows(TRACKS + "WHERE fold(t.title) LIKE ?" + f.format("al") + " ORDER BY ar.sort,al.pos,t.pos LIMIT 60", k)}

@app.post("/api/rescan")
def rescan_api():
    return rescan()

def safe(p):
    full = os.path.abspath(os.path.join(MUSIC, p))
    if not full.startswith(os.path.abspath(MUSIC) + os.sep) or not os.path.isfile(full):
        raise HTTPException(404)
    return full

@app.get("/api/cover/{kind}/{id}")
def cover(kind: str, id: str, request: Request):
    t = {"album": "albums", "artist": "artists"}.get(kind)
    r = rows(f"SELECT cover,priv FROM {t} WHERE id=?", id) if t else []
    if not r or not r[0]["cover"] or (r[0]["priv"] and not unlocked(request)):
        raise HTTPException(404)
    c = r[0]["cover"]
    p = os.path.join(DATA, "covers", os.path.basename(c[1:])) if c.startswith("@") else safe(c)
    if not os.path.isfile(p):
        raise HTTPException(404)
    return FileResponse(p, headers={"Cache-Control": "private, max-age=3600"})

@app.get("/api/stream/{id}")
def stream(id: str, request: Request):
    r = rows("SELECT t.path,t.ext,al.priv FROM tracks t JOIN albums al ON al.id=t.album_id WHERE t.id=?", id)
    if not r or (r[0]["priv"] and not unlocked(request)):
        raise HTTPException(404)
    return FileResponse(safe(r[0]["path"]), media_type=MIME.get(r[0]["ext"], "application/octet-stream"))

class Name(BaseModel):
    name: str

class Ids(BaseModel):
    ids: list[str]

def init_pl():
    c = db()
    with c:
        c.executescript("""CREATE TABLE IF NOT EXISTS playlists(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pl_tracks(pid INTEGER,path TEXT,pos INTEGER);""")
    c.close()

def run(sql, *a):
    c = db()
    try:
        with c:
            return c.execute(sql, a).lastrowid
    finally:
        c.close()

def hide_pl(v):
    return "" if v else " AND NOT EXISTS (SELECT 1 FROM pl_tracks x JOIN tracks t ON t.path=x.path JOIN albums al ON al.id=t.album_id WHERE x.pid=p.id AND al.priv=1)"

@app.get("/api/playlists")
def pls(request: Request):
    return rows("SELECT p.id,p.name,(SELECT COUNT(*) FROM pl_tracks x JOIN tracks t ON t.path=x.path WHERE x.pid=p.id) AS n FROM playlists p WHERE 1=1"
                + hide_pl(unlocked(request)) + " ORDER BY p.name COLLATE NOCASE")

@app.post("/api/playlists")
def pl_new(b: Name):
    return {"id": run("INSERT INTO playlists(name) VALUES(?)", b.name.strip()[:80] or "sem nome")}

@app.get("/api/playlists/{id}")
def pl_get(id: int, request: Request):
    p = rows("SELECT p.id,p.name FROM playlists p WHERE p.id=?" + hide_pl(unlocked(request)), id)
    if not p:
        raise HTTPException(404)
    p[0]["tracks"] = rows(TRACKS + "JOIN pl_tracks x ON x.path=t.path WHERE x.pid=? ORDER BY x.pos", id)
    return p[0]

@app.put("/api/playlists/{id}")
def pl_ren(id: int, b: Name):
    run("UPDATE playlists SET name=? WHERE id=?", b.name.strip()[:80] or "sem nome", id)
    return {}

@app.delete("/api/playlists/{id}")
def pl_del(id: int):
    run("DELETE FROM pl_tracks WHERE pid=?", id)
    run("DELETE FROM playlists WHERE id=?", id)
    return {}

@app.post("/api/playlists/{id}/tracks")
def pl_add(id: int, b: Ids):
    for tid in b.ids:
        r = rows("SELECT path FROM tracks WHERE id=?", tid)
        if r and not rows("SELECT 1 FROM pl_tracks WHERE pid=? AND path=?", id, r[0]["path"]):
            run("INSERT INTO pl_tracks VALUES(?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM pl_tracks WHERE pid=?))", id, r[0]["path"], id)
    return {}

@app.delete("/api/playlists/{id}/tracks/{tid}")
def pl_rm(id: int, tid: str):
    run("DELETE FROM pl_tracks WHERE pid=? AND path=(SELECT path FROM tracks WHERE id=?)", id, tid)
    return {}

@app.get("/sw.js", include_in_schema=False)
def sw():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "sw.js"),
                        media_type="text/javascript", headers={"Cache-Control": "no-cache"})

@app.get("/manifest.webmanifest", include_in_schema=False)
def manifest():
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "manifest.webmanifest"),
                        media_type="application/manifest+json", headers={"Cache-Control": "no-cache"})

app.mount("/", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static"), html=True), name="static")
