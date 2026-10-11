"""Rendered PDF, editable-text PowerPoint, and a portable engineering handoff."""

import asyncio
import base64
import io
import json
import re
import secrets
from pathlib import Path
import zipfile

from app import design_service, repository

_export_gate = asyncio.Semaphore(1)
_tailwind = (
    Path(__file__).resolve().parents[2]
    / "frontend/public/vendor/tailwindcss-play-3.4.17.js"
)
if not _tailwind.is_file():
    _tailwind = Path(__file__).with_name("vendor") / "tailwindcss-play-3.4.17.js"


def asset_document(conn, project, screen):
    document = design_service.inline_images(
        design_service.render_document(
            screen["body"], project["theme"], screen["id"], False
        )
    )
    for source_id, token in set(
        re.findall(r"/api/design/assets/(\d+)/([A-Za-z0-9_-]+)", document)
    ):
        row = conn.execute(
            "SELECT content,metadata FROM design_sources WHERE id=?", (int(source_id),)
        ).fetchone()
        if row and secrets.compare_digest(
            json.loads(row["metadata"]).get("asset_token", ""), token
        ):
            document = document.replace(
                f"/api/design/assets/{source_id}/{token}", row["content"]
            )
    return document


async def capture_document(
    document: str, width: int, height: int, editable_text: bool = False
) -> dict:
    """Sandbox model scripts, block outbound traffic, and load only the pinned Tailwind dependency."""
    import html
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                viewport={"width": width, "height": height}, device_scale_factor=1
            )
            shell = (
                '<style>body{margin:0}</style><iframe sandbox="allow-scripts allow-forms" style="display:block;border:0;width:100%;height:100vh" srcdoc="'
                + html.escape(document, quote=True)
                + '"></iframe>'
            )

            async def route(request):
                url = request.request.url
                if url == "https://design-export.invalid/":
                    await request.fulfill(content_type="text/html", body=shell)
                elif (
                    url
                    == "https://design-export.invalid/vendor/tailwindcss-play-3.4.17.js"
                ):
                    await request.fulfill(
                        content_type="application/javascript",
                        path=str(_tailwind),
                    )
                elif request.request.resource_type == "image":
                    from app.design_capture import public_image

                    try:
                        data, media = await public_image(url)
                        await request.fulfill(content_type=media, body=data)
                    except Exception:
                        await request.abort()
                else:
                    await request.abort()

            await context.route("**/*", route)
            page = await context.new_page()
            await page.goto(
                "https://design-export.invalid/", wait_until="load", timeout=10000
            )
            frame = next(frame for frame in page.frames if frame != page.main_frame)
            await frame.wait_for_function(
                "Array.from(document.querySelectorAll('style')).some(s=>s.textContent.includes('--tw-'))",
                timeout=5000,
            )
            # Preserve the original viewport units while expanding the isolated iframe for a full-page capture.
            frozen = await frame.evaluate(r"""() => Array.from(document.querySelectorAll('style'))
              .map(style=>style.textContent.replace(/(-?\d*\.?\d+)(?:s|l|d)?vh\b/g,(_,number)=>(Number(number)*innerHeight/100)+'px')).join('\n')""")
            await frame.add_style_tag(content=frozen)
            actual_height = min(
                4000,
                max(
                    height,
                    await frame.evaluate(
                        "Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)"
                    ),
                ),
            )
            await page.locator("iframe").evaluate(
                '(el,height)=>el.style.height=height+"px"', actual_height
            )
            texts = []
            if editable_text:
                texts = await frame.evaluate("""() => {
                  const result=[];
                  document.querySelectorAll('body *').forEach(el=>{
                    if(result.length>=250 || el.children.length || el.closest('svg,script,style') || !el.textContent.trim()) return;
                    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
                    if(!r.width || !r.height || s.visibility==='hidden' || s.display==='none' || el.closest('[hidden],dialog:not([open])'))return;
                    const key=String(result.length);el.setAttribute('data-pragna-export-text',key);
                    result.push({text:el.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,
                      size:parseFloat(s.fontSize),font:s.fontFamily.split(',')[0].replace(/['"]/g,''),
                      color:s.color,bold:parseInt(s.fontWeight)>=600,align:s.textAlign});
                  });return result.slice(0,250);
                }""")
                await frame.add_style_tag(
                    content="[data-pragna-export-text]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}"
                )
            png = await page.screenshot(full_page=True, timeout=10000)
            return {"png": png, "width": width, "height": actual_height, "texts": texts}
        finally:
            await browser.close()


def _pdf(pages):
    from reportlab.pdfgen.canvas import Canvas
    from reportlab.lib.utils import ImageReader

    output = io.BytesIO()
    canvas = Canvas(output)
    for page in pages:
        width, height = page["width"] * 0.6, page["height"] * 0.6
        canvas.setPageSize((width, height))
        canvas.drawImage(
            ImageReader(io.BytesIO(page["png"])), 0, 0, width=width, height=height
        )
        canvas.showPage()
    canvas.save()
    return output.getvalue()


def _pptx(pages, project):
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    import re

    deck = Presentation()
    deck.slide_width = Inches(13.333)
    deck.slide_height = Inches(7.5)
    for page in pages:
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        scale = min(
            int(deck.slide_width) / page["width"],
            int(deck.slide_height) / page["height"],
        )
        x_offset = (int(deck.slide_width) - page["width"] * scale) / 2
        slide.shapes.add_picture(
            io.BytesIO(page["png"]),
            int(x_offset),
            0,
            width=int(page["width"] * scale),
            height=int(page["height"] * scale),
        )
        for text in page["texts"]:
            box = slide.shapes.add_textbox(
                int(x_offset + text["x"] * scale),
                int(text["y"] * scale),
                int(max(1, text["width"] * scale)),
                int(max(1, text["height"] * scale)),
            )
            frame = box.text_frame
            frame.margin_top = frame.margin_bottom = frame.margin_left = (
                frame.margin_right
            ) = 0
            frame.word_wrap = True
            p = frame.paragraphs[0]
            p.text = text["text"]
            p.font.name = text["font"]
            p.font.size = Pt(max(6, text["size"] * scale / 12700))
            p.font.bold = text["bold"]
            color = re.search(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", text["color"])
            if color:
                p.font.color.rgb = RGBColor(*(int(c) for c in color.groups()))
            p.alignment = {"center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}.get(
                text["align"], PP_ALIGN.LEFT
            )
        slide.notes_slide.notes_text_frame.text = (
            "Pragna Design: "
            + project["name"]
            + ". Text boxes are editable; complex visuals remain rendered artwork."
        )
    output = io.BytesIO()
    deck.save(output)
    return output.getvalue()


async def visual_export(conn, project, format):
    screens = [
        s for s in repository.list_design_screens(conn, project["id"]) if s.get("body")
    ]
    if not screens:
        raise ValueError("Build a design before exporting")
    pages = []

    async def run():
        async with _export_gate:
            for screen in screens:
                layout = screen.get("layout", {})
                width = layout.get("width") or (
                    390 if project["device"] == "mobile" else 1280
                )
                height = layout.get("height") or (
                    720 if project["kind"] == "presentation" else 800
                )
                pages.append(
                    await capture_document(
                        asset_document(conn, project, screen),
                        width,
                        height,
                        format == "pptx",
                    )
                )
            return (
                await asyncio.to_thread(_pdf, pages)
                if format == "pdf"
                else await asyncio.to_thread(_pptx, pages, project)
            )

    return await asyncio.wait_for(run(), 120)


def handoff_bundle(conn, project):
    output = io.BytesIO()
    screens = repository.list_design_screens(conn, project["id"])
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("design-tokens.json", json.dumps(project["theme"], indent=2))
        manifest = {
            "name": project["name"],
            "kind": project["kind"],
            "device": project["device"],
            "artboards": [],
        }
        for index, screen in enumerate(screens):
            if not screen.get("body"):
                continue
            file = f"artboards/{index + 1:02d}.html"
            archive.writestr(
                file,
                asset_document(conn, project, screen).replace(
                    design_service._TAILWIND_LOCAL,
                    "../vendor/tailwindcss-play-3.4.17.js",
                ),
            )
            archive.writestr(
                f"source/{index + 1:02d}.body.html",
                design_service._inner_body(asset_document(conn, project, screen)),
            )
            manifest["artboards"].append(
                {
                    "name": screen["name"],
                    "file": file,
                    "layout": screen.get("layout", {}),
                    "checks": design_service.screen_quality(
                        screen["body"], project["theme"], project["device"]
                    ),
                }
            )
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        archive.write(
            _tailwind,
            "vendor/tailwindcss-play-3.4.17.js",
        )
        instructions = (
            f"# {project['name']}\n\nBuild this {project['kind']} from the included artboards.\n\n"
            "Preserve the theme tokens, responsive behavior, actual content and working local interactions. "
            "Replace clearly identified demo data with the project's real data layer and existing components. "
            "Use manifest.json for the artboards and checks, source/ for editable HTML, and design-tokens.json for the palette. "
            "Inspect each artboard at 390px, 768px and desktop widths. Resolve remaining accessibility and behavior findings.\n\n"
            "The package is ready for a local coding agent, Claude Code, Codex, or an existing development workflow. "
            "Generated prototypes are not a production backend; connect authentication and services in the target codebase.\n"
        )
        archive.writestr("HANDOFF.md", instructions)
        system_id = project.get("design_system_id")
        if system_id:
            system = conn.execute(
                "SELECT name,guidelines,components FROM design_systems WHERE id=?",
                (system_id,),
            ).fetchone()
            if system:
                archive.writestr(
                    "design-system.json", json.dumps(dict(system), indent=2)
                )
    return output.getvalue()
