import base64
import json

import pytest

from app import design_service, repository
from app.db import get_connection, init_db
from app.design_service import DesignError


def make_conn(tmp_path):
    db_path = str(tmp_path / "pragna.db")
    init_db(db_path)
    conn = get_connection(db_path)
    repository.create_user(conn, "test@example.com", "hash")
    return conn


def fake_llm(plan_screens=("Home", "Cart"), broken=()):
    """Stands in for OmniRoute: planner gets JSON, screen calls get an html block (or prose for `broken`)."""
    calls = []

    async def llm(settings, messages):
        calls.append(messages)
        if messages[0]["content"] == design_service._PLAN_SYSTEM:
            return json.dumps({
                "project_name": "Food app",
                "screens": [{"name": n, "purpose": f"the {n} screen"} for n in plan_screens],
            })
        user = messages[-1]["content"]
        user = user if isinstance(user, str) else user[0]["text"]
        if any(f'"{name}"' in user for name in broken):
            return "Sorry, I cannot do that."
        return "```html\n<main class=\"bg-surface p-4\">built</main>\n```"

    llm.calls = calls
    return llm


def sse_events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


@pytest.fixture
def other_headers(client):
    res = client.post("/api/auth/register", json={"email": "other@example.com", "password": "otherpassword123"})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


# --- pure helpers ----------------------------------------------------------

def test_parse_html_block_variants():
    assert design_service.parse_html_block("text\n```html\n<p>a</p>\n```\nmore") == "<p>a</p>"
    assert design_service.parse_html_block("```\n<p>b</p>\n```") == "<p>b</p>"
    assert design_service.parse_html_block("<div>raw</div>") == "<div>raw</div>"
    assert design_service.parse_html_block("```html\n<html><body><p>c</p></body></html>\n```") == "<p>c</p>"
    assert design_service.parse_html_block("no markup here") is None


def test_validate_theme_rejects_injection():
    assert design_service.validate_theme(None) == design_service.DEFAULT_THEME
    with pytest.raises(DesignError):
        design_service.validate_theme({"primary": "red;}</style><script>x</script>"})
    with pytest.raises(DesignError):
        design_service.validate_theme({"font": "Evil Font"})
    with pytest.raises(DesignError):
        design_service.validate_theme({"radius": "1px;color:red"})


def test_render_document_maps_theme_and_gates_editor_script():
    theme = design_service.validate_theme({"primary": "#ff0000", "font": "Poppins", "radius": "4px"})
    live = design_service.render_document("<p>x</p>", theme, 7, interactive=True)
    assert '"primary": "#ff0000"' in live and '"theme": "4px"' in live
    assert "family=Poppins" in live and "pragna-design" in live and "SID = 7" in live
    exported = design_service.render_document("<p>x</p>", theme, 7, interactive=False)
    assert "pragna-design" not in exported and "<p>x</p>" in exported


# --- repository: versions --------------------------------------------------

def test_version_add_restore_and_prune(tmp_path, monkeypatch):
    conn = make_conn(tmp_path)
    pid = repository.create_design_project(conn, 1, "P", "mobile", design_service.DEFAULT_THEME)
    sid = repository.create_design_screen(conn, pid, "Home", 0)
    monkeypatch.setattr(repository, "MAX_SCREEN_VERSIONS", 3)

    ids = [repository.add_screen_version(conn, sid, f"<p>{i}</p>", f"v{i}") for i in range(5)]
    versions = repository.list_screen_versions(conn, sid)
    assert [v["id"] for v in versions] == ids[:1:-1]  # newest three kept, newest first
    assert repository.get_design_screen(conn, 1, sid)["body"] == "<p>4</p>"

    assert repository.restore_screen_version(conn, sid, ids[2])
    assert repository.get_design_screen(conn, 1, sid)["body"] == "<p>2</p>"
    assert not repository.restore_screen_version(conn, sid, ids[0])  # pruned away


# --- planner / editor ------------------------------------------------------

async def test_plan_flow_falls_back_to_one_screen(monkeypatch):
    async def bad(settings, messages):
        return "not json at all"

    monkeypatch.setattr(design_service, "_llm", bad)
    plan = await design_service.plan_flow(None, "A food delivery app", "mobile", 5, [])
    assert [s["name"] for s in plan["screens"]] == ["A food delivery app"]


async def test_edit_sends_selected_element(monkeypatch):
    llm = fake_llm()
    monkeypatch.setattr(design_service, "_llm", llm)
    await design_service.edit_screen_body(None, "<main><button>Buy</button></main>", "make it a card", "<button>Buy</button>")
    prompt = llm.calls[0][-1]["content"]
    assert "Change ONLY this element" in prompt and "<button>Buy</button>" in prompt and "make it a card" in prompt


# --- HTTP ------------------------------------------------------------------

def test_projects_are_scoped_to_their_owner(client, other_headers):
    project_id = client.post("/api/design/projects", json={}).json()["project"]["id"]

    assert client.get(f"/api/design/projects/{project_id}").status_code == 200
    assert client.get(f"/api/design/projects/{project_id}", headers=other_headers).status_code == 404
    assert client.delete(f"/api/design/projects/{project_id}", headers=other_headers).status_code == 404
    assert client.get("/api/design/projects", headers=other_headers).json() == []
    assert client.get("/api/design/projects", headers={"Authorization": ""}).status_code == 401


def test_generate_streams_screens_and_persists(client, monkeypatch):
    monkeypatch.setattr(design_service, "_llm", fake_llm(plan_screens=("Home", "Cart", "Checkout"), broken=("Cart",)))
    project_id = client.post("/api/design/projects", json={"device": "web"}).json()["project"]["id"]

    events = sse_events(client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "food delivery"}))

    assert events[0]["type"] == "plan" and events[0]["project_name"] == "Food app"
    assert events[-1]["type"] == "done"
    built = [e for e in events if e["type"] == "screen"]
    failed = [e for e in events if e["type"] == "screen_error"]
    assert len(built) == 2 and len(failed) == 1  # one bad screen does not sink the flow
    assert all("tailwind" in e["html"] for e in built)

    saved = client.get(f"/api/design/projects/{project_id}").json()
    assert saved["project"]["name"] == "Food app"
    assert [s["name"] for s in saved["screens"]] == ["Home", "Cart", "Checkout"]
    assert [bool(s["body"]) for s in saved["screens"]] == [True, False, True]


def test_generate_applies_planned_theme_and_ignores_invalid(client, monkeypatch):
    inner = fake_llm()
    brand = {"primary": "#c2410c", "on_primary": "#ffffff", "surface": "#1c1917", "background": "#0c0a09",
             "foreground": "#fafaf9", "muted": "#a8a29e", "border": "#292524", "radius": "4px", "font": "Playfair Display"}

    async def llm(settings, messages):
        if messages[0]["content"] == design_service._PLAN_SYSTEM:
            theme = brand if "ramen" in messages[-1]["content"] else {"primary": "red; }</style><script>"}
            return json.dumps({"project_name": "P", "theme": theme, "screens": [{"name": "Home", "purpose": "x"}]})
        return await inner(settings, messages)

    monkeypatch.setattr(design_service, "_llm", llm)
    ok = client.post("/api/design/projects", json={}).json()["project"]["id"]
    events = sse_events(client.post(f"/api/design/projects/{ok}/generate", json={"prompt": "ramen shop"}))
    assert events[0]["theme"] == brand
    built = next(e for e in events if e["type"] == "screen")
    assert "#c2410c" in built["html"]  # streamed screens use the planned theme, not the default
    assert client.get(f"/api/design/projects/{ok}").json()["project"]["theme"] == brand

    bad = client.post("/api/design/projects", json={}).json()["project"]["id"]
    events = sse_events(client.post(f"/api/design/projects/{bad}/generate", json={"prompt": "bank app"}))
    assert events[0]["theme"] == design_service.DEFAULT_THEME


def test_generate_rejects_empty_and_non_image(client):
    project_id = client.post("/api/design/projects", json={}).json()["project"]["id"]
    assert client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "  "}).status_code == 400
    bad = client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "x", "image": "data:text/html;base64,AAAA"})
    assert bad.status_code == 400


def test_edit_versions_restore_and_theme_rerender(client, monkeypatch):
    monkeypatch.setattr(design_service, "_llm", fake_llm(plan_screens=("Home",)))
    project_id = client.post("/api/design/projects", json={}).json()["project"]["id"]
    client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "app"})
    screen = client.get(f"/api/design/projects/{project_id}").json()["screens"][0]
    first_version = screen["version_id"]

    async def edited(settings, messages):
        return "```html\n<main>edited</main>\n```"

    monkeypatch.setattr(design_service, "_llm", edited)
    res = client.post(f"/api/design/screens/{screen['id']}/edit", json={"instruction": "change it", "element_html": "<main>"})
    assert res.status_code == 200 and "edited" in res.json()["body"]
    assert len(client.get(f"/api/design/screens/{screen['id']}/versions").json()) == 2

    restored = client.post(f"/api/design/screens/{screen['id']}/restore", json={"version_id": first_version})
    assert "built" in restored.json()["body"]

    themed = client.patch(f"/api/design/projects/{project_id}", json={"theme": {"primary": "#00ff00"}}).json()
    assert '"primary": "#00ff00"' in themed["screens"][0]["html"]
    assert client.patch(f"/api/design/projects/{project_id}", json={"theme": {"primary": "nope"}}).status_code == 400


def test_edit_failure_keeps_current_version(client, monkeypatch):
    monkeypatch.setattr(design_service, "_llm", fake_llm(plan_screens=("Home",)))
    project_id = client.post("/api/design/projects", json={}).json()["project"]["id"]
    client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "app"})
    screen = client.get(f"/api/design/projects/{project_id}").json()["screens"][0]

    async def down(settings, messages):
        raise DesignError("The model could not be reached: boom")

    monkeypatch.setattr(design_service, "_llm", down)
    res = client.post(f"/api/design/screens/{screen['id']}/edit", json={"instruction": "change it"})
    assert res.status_code == 502 and "boom" in res.json()["detail"]
    assert client.get(f"/api/design/projects/{project_id}").json()["screens"][0]["version_id"] == screen["version_id"]


def test_export_is_attachment_without_editor_script(client, monkeypatch, other_headers):
    monkeypatch.setattr(design_service, "_llm", fake_llm(plan_screens=("Home Page",)))
    project_id = client.post("/api/design/projects", json={}).json()["project"]["id"]
    client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "app"})
    screen_id = client.get(f"/api/design/projects/{project_id}").json()["screens"][0]["id"]

    res = client.get(f"/api/design/screens/{screen_id}/export")
    assert res.status_code == 200
    assert res.headers["content-disposition"] == 'attachment; filename="Home-Page.html"'
    assert "pragna-design" not in res.text and "built" in res.text
    assert "https://cdn.tailwindcss.com" in res.text  # the file must work outside Pragna
    assert client.get(f"/api/design/screens/{screen_id}/export", headers=other_headers).status_code == 404


def test_export_inlines_stored_images(tmp_path, monkeypatch):
    png = b"\x89PNG-test"
    (tmp_path / "img_1_abc.png").write_bytes(png)
    monkeypatch.setattr(design_service.image_service, "generated_images_dir", lambda: tmp_path)

    html = '<img src="/generated_images/img_1_abc.png"><img src="/generated_images/img_2_missing.png">'
    out = design_service.inline_images(html)

    assert "data:image/png;base64," + base64.b64encode(png).decode() in out
    (tmp_path / "img_3_def.jpg").write_bytes(b"jpegbytes")
    assert "data:image/jpeg;base64," + base64.b64encode(b"jpegbytes").decode() in design_service.inline_images(
        '<img src="/generated_images/img_3_def.jpg">')
    assert "/generated_images/img_2_missing.png" in out  # a missing file is left alone, not broken
    traversal = '<img src="/generated_images/../../etc/passwd.png">'
    assert design_service.inline_images(traversal) == traversal  # only plain img_*.png names are ever read


class _Resp:
    def __init__(self, status=200, body=None, content=b""):
        self.status_code, self._body, self.content, self.headers = status, body, content, {"retry-after": "0"}

    def raise_for_status(self):
        assert self.status_code < 400

    def json(self):
        return self._body


def _fake_client(handler):
    class Client:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): ...
        async def post(self, url, headers=None, json=None): return handler("post", url, json)
        async def get(self, url, params=None): return handler("get", url, params)

    return Client


async def test_rate_limited_provider_is_skipped_and_fallback_used(monkeypatch):
    calls = []

    def handler(method, url, payload):
        calls.append(payload["model"])
        if payload["model"].startswith("codex/"):
            return _Resp(502)  # an upstream refusal blocks the provider just like a 429 does
        return _Resp(200, {"data": [{"b64_json": "aGk="}]})

    async def no_stock(query, aspect, skip=None):
        return None

    monkeypatch.setattr(design_service.httpx, "AsyncClient", _fake_client(handler))
    monkeypatch.setattr(design_service.image_service, "find_stock_photo", no_stock)
    monkeypatch.setattr(design_service.image_service, "save_base64_image", lambda b64, max_width=None: "/generated_images/img_1_x.png")
    monkeypatch.setattr(design_service, "_provider_blocked_until", {})
    settings = type("S", (), {"omniroute_base_url": "http://x", "omniroute_api_key": "k"})()

    assert await design_service._picture(settings, "a boat", "ctx", 600, 400) == "/generated_images/img_1_x.png"
    assert await design_service._picture(settings, "a house", "ctx", 600, 400) == "/generated_images/img_1_x.png"
    # Codex is tried once, then both Codex models are skipped for the second picture.
    assert calls == ["codex/gpt-5.6-terra", "antigravity/gemini-3.1-flash-image", "antigravity/gemini-3.1-flash-image"]


async def test_stock_photo_is_used_before_gemini_when_codex_is_unavailable(monkeypatch):
    searched = []

    def handler(method, url, payload):
        return _Resp(429)  # every generator is rate limited

    async def stock(query, aspect, skip=None):
        searched.append((query, round(aspect, 2)))
        return "aGk="

    monkeypatch.setattr(design_service.httpx, "AsyncClient", _fake_client(handler))
    monkeypatch.setattr(design_service.image_service, "find_stock_photo", stock)
    monkeypatch.setattr(design_service.image_service, "save_base64_image", lambda b64, max_width=None: "/generated_images/img_2_s.jpg")
    monkeypatch.setattr(design_service, "_provider_blocked_until", {})
    settings = type("S", (), {"omniroute_base_url": "http://x", "omniroute_api_key": "k"})()

    out = await design_service._picture(settings, "A teak houseboat gliding on Kerala backwaters at sunrise", "ctx", 900, 600)

    assert out == "/generated_images/img_2_s.jpg"
    assert searched == [("teak houseboat gliding Kerala backwaters", 1.5)]  # content words only, slot shape passed on


def test_stock_queries_drop_filler_words():
    assert design_service._stock_queries("A bowl of ramen") == ["bowl ramen"]
    assert design_service._stock_queries("Close-up of the hands with temple jewelry in warm light and shadow") == [
        "Close-up hands temple jewelry warm", "Close-up hands temple"]
    assert design_service._stock_queries("") == []
    # brand terms come first (those sharing a word with the label ahead of the rest), the label's own words last
    assert design_service._stock_queries("Brick courtyard", ("tropical house", "courtyard garden", "bowl ramen")) == [
        "courtyard garden", "tropical house", "bowl ramen", "Brick courtyard"]


async def test_find_stock_photo_takes_only_free_licences_and_the_best_shaped(monkeypatch):
    from app import image_service

    def page(title, w, h, lic, url="https://upload.wikimedia.org/x/%s.jpg"):
        return {"imageinfo": [{"width": w, "height": h, "mime": "image/jpeg", "thumburl": url % title,
                               "extmetadata": {"LicenseShortName": {"value": lic}}}]}

    commons = {"query": {"pages": {
        "1": page("sa", 1600, 1067, "CC BY-SA 3.0"),            # needs attribution: rejected
        "2": page("wide", 2000, 1000, "Public domain"),          # ok but 2:1
        "3": page("square", 1000, 1000, "CC0 1.0"),              # ok, closest to a 1:1 slot
        "4": page("tiny", 400, 400, "Public domain"),            # too small
        "5": page("offsite", 1000, 1000, "CC0", url="https://evil.example/%s.jpg"),  # not Wikimedia
    }}}
    fetched = []

    searched_urls = []

    def handler(method, url, params):
        if "api.php" in url:
            searched_urls.append(url)
            return _Resp(200, commons)
        fetched.append(url)
        return _Resp(200, content=b"pixels")

    monkeypatch.setattr(image_service.httpx, "AsyncClient", _fake_client(handler))
    monkeypatch.setattr(image_service, "_stock_cache", {})

    assert await image_service.find_stock_photo("anything", 1.0) == base64.b64encode(b"pixels").decode()
    assert fetched == ["https://upload.wikimedia.org/x/square.jpg"]

    used = set()
    await image_service.find_stock_photo("anything", 1.0, used)
    assert used == {"https://upload.wikimedia.org/x/square.jpg"}
    await image_service.find_stock_photo("anything", 1.0, used)  # the same photo is not picked twice
    assert fetched[-1] == "https://upload.wikimedia.org/x/wide.jpg"
    assert sum("api.php" in u for u in searched_urls) == 1  # the phrase was searched once, then served from the cache


def test_save_base64_image_shrinks_to_jpeg(tmp_path, monkeypatch):
    import io
    from PIL import Image
    from app import image_service

    big = io.BytesIO()
    Image.new("RGB", (2400, 1200), "red").save(big, "PNG")
    monkeypatch.setattr(image_service, "generated_images_dir", lambda: tmp_path)

    url = image_service.save_base64_image(base64.b64encode(big.getvalue()).decode(), max_width=1280)

    saved = Image.open(tmp_path / url.rsplit("/", 1)[1])
    assert url.endswith(".jpg") and saved.size == (1280, 640)


def test_placeholders_take_theme_colours():
    theme = {**design_service.DEFAULT_THEME, "border": "#112233", "muted": "#aabbcc"}
    body = (
        '<img src="https://placehold.co/600x400?text=Boat">'
        '<img src="https://placehold.co/120x120/ffffff/000000?text=Old">'
        '<img src="/generated_images/img_1_a.jpg">'
    )
    out = design_service.render_document(body, theme, 1, interactive=False)

    assert "https://placehold.co/600x400/112233/aabbcc?text=Boat" in out
    assert "scrollbar-color:#112233 transparent" in out  # no default white scrollbars on a dark design
    assert "https://placehold.co/120x120/112233/aabbcc?text=Old" in out  # a colour the model chose is replaced too
    assert "/generated_images/img_1_a.jpg" in out


def test_preview_uses_local_tailwind_and_export_uses_cdn():
    theme = design_service.DEFAULT_THEME
    preview = design_service.render_document("<p>x</p>", theme, 1, interactive=True)
    exported = design_service.render_document("<p>x</p>", theme, 1, interactive=False, standalone=True)

    assert "/vendor/tailwindcss-play-3.4.17.js" in preview and "cdn.tailwindcss.com" not in preview
    assert "https://cdn.tailwindcss.com" in exported and "/vendor/" not in exported
    assert f"html{{background:{theme['background']}}}" in preview  # themed from the first paint, not white


def refine_llm(audit_reply):
    """Planner and first build as fake_llm; the audit call gets audit_reply."""
    inner = fake_llm(plan_screens=("Home",))

    async def llm(settings, messages):
        user = messages[-1]["content"]
        if isinstance(user, str) and "Audit this screen" in user:
            return audit_reply
        return await inner(settings, messages)

    return llm


def test_refine_streams_a_repaired_screen_in_place(client, monkeypatch):
    repaired = '<main class="bg-surface p-4">built</main><section class="p-8">asymmetric rework</section>'
    monkeypatch.setattr(design_service, "_llm", refine_llm(f"Audit: 6/10. Tells: feature-tile grid.\n```html\n{repaired}\n```"))
    project_id = client.post("/api/design/projects", json={}).json()["project"]["id"]

    events = sse_events(client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "app"}))

    screens = [e for e in events if e["type"] == "screen"]
    assert len(screens) == 2 and screens[0]["id"] == screens[1]["id"]  # first build, then the repair of the same screen
    assert "asymmetric rework" not in screens[0]["body"] and "asymmetric rework" in screens[1]["body"]
    assert events[-1]["type"] == "done"
    saved = client.get(f"/api/design/projects/{project_id}").json()["screens"][0]
    assert "asymmetric rework" in saved["body"] and saved["version_id"] == screens[0]["version_id"]  # same version, updated


@pytest.mark.parametrize("reply", [
    "Audit: 1/10. Tells: none worth fixing.",                      # clean: nothing to repair
    "Audit: 7/10.\n```html\n<p>x</p>\n```",                        # repair far smaller than the original: rejected
    "I cannot do that.",                                           # no html at all
])
def test_refine_leaves_the_screen_alone_when_the_repair_is_clean_or_unusable(client, monkeypatch, reply):
    monkeypatch.setattr(design_service, "_llm", refine_llm(reply))
    project_id = client.post("/api/design/projects", json={}).json()["project"]["id"]

    events = sse_events(client.post(f"/api/design/projects/{project_id}/generate", json={"prompt": "app"}))

    assert len([e for e in events if e["type"] == "screen"]) == 1
    assert "built" in client.get(f"/api/design/projects/{project_id}").json()["screens"][0]["body"]


async def test_find_stock_photo_retries_once_when_throttled(monkeypatch):
    from app import image_service

    attempts = []

    def handler(method, url, params):
        attempts.append(method)
        return _Resp(429)

    monkeypatch.setattr(image_service.httpx, "AsyncClient", _fake_client(handler))
    monkeypatch.setattr(image_service, "_stock_cache", {})

    assert await image_service.find_stock_photo("anything", 1.0) is None
    assert attempts == ["get", "get"]  # one retry, then give up so the next source is tried


async def test_illustrate_shares_one_no_repeat_set_across_screens(monkeypatch):
    seen = []

    async def picture(settings, label, context, w, h, terms=(), used=None):
        seen.append(used)
        return None

    monkeypatch.setattr(design_service, "_picture", picture)
    settings = type("S", (), {"omniroute_base_url": "http://x", "omniroute_api_key": "k"})()
    shared = set()

    await design_service.illustrate(settings, '<img src="https://placehold.co/600x400?text=a">', "", (), shared)
    await design_service.illustrate(settings, '<img src="https://placehold.co/600x400?text=b">', "", (), shared)

    assert seen == [shared, shared]


async def test_unsplash_photos_are_kept_only_when_they_exist(monkeypatch):
    real = "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80"
    made_up = "https://images.unsplash.com/photo-9999999999999-deadbeef?auto=format&fit=crop&w=800&q=80"

    class Resp:
        def __init__(self, status, ctype="image/jpeg", content=b"jpeg"):
            self.status_code, self.headers, self.content = status, {"content-type": ctype}, content

    def handler(method, url, params):
        return Resp(200) if "1464822759023" in url else Resp(404, "text/html", b"nope")

    monkeypatch.setattr(design_service.httpx, "AsyncClient", _fake_client(handler))
    monkeypatch.setattr(design_service.image_service, "save_base64_image", lambda b64, max_width=None: "/generated_images/img_9_u.jpg")

    out = await design_service.resolve_unsplash(f'<img src="{real}"><img src="{made_up}"><img src="https://evil.example/photo-1.jpg">')

    assert '<img src="/generated_images/img_9_u.jpg">' in out            # a real photo is saved locally
    assert "https://placehold.co/800x528?text=Photo" in out               # a made-up id becomes a placeholder to fill
    assert "https://evil.example/photo-1.jpg" in out and "unsplash" not in out
