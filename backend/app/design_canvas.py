"""Deterministic canvas operations with validated CSS and stable interaction targets."""

import re
import secrets

from bs4 import BeautifulSoup, Tag

STYLE_PROPERTIES = {
    "padding",
    "padding-top",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "margin",
    "margin-top",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "gap",
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "font-size",
    "line-height",
    "letter-spacing",
    "border-radius",
    "opacity",
    "color",
    "background-color",
    "border-color",
    "font-weight",
    "text-align",
    "display",
    "flex-direction",
    "justify-content",
    "align-items",
    "align-self",
    "position",
    "left",
    "top",
    "z-index",
    "transform",
    "font-family",
}
ENUMS = {
    "text-align": {"left", "center", "right", "justify"},
    "display": {"block", "inline", "inline-block", "flex", "grid", "none"},
    "flex-direction": {"row", "column", "row-reverse", "column-reverse"},
    "justify-content": {
        "flex-start",
        "center",
        "flex-end",
        "space-between",
        "space-around",
        "space-evenly",
    },
    "align-items": {"flex-start", "center", "flex-end", "stretch", "baseline"},
    "align-self": {"auto", "flex-start", "center", "flex-end", "stretch"},
    "position": {"relative", "absolute", "static", "sticky"},
    "font-weight": {str(n) for n in range(100, 1000, 100)},
}


def valid_style(property: str, value: str) -> bool:
    if property not in STYLE_PROPERTIES or len(value) > 100:
        return False
    if value == "":
        return True
    if property in ENUMS:
        return value in ENUMS[property]
    if property.endswith("color") or property == "color":
        return bool(re.fullmatch(r"#[\da-fA-F]{6}|transparent|currentColor", value))
    if property == "font-family":
        from app.design_service import FONTS

        return value in FONTS
    if property == "transform":
        return value in {"none", "scaleX(-1)", "scaleY(-1)", "scale(-1,-1)"}
    if property in {"opacity", "z-index"}:
        try:
            n = float(value)
            return 0 <= n <= (1 if property == "opacity" else 100)
        except ValueError:
            return False
    return bool(
        re.fullmatch(
            r"(?:auto|0|-?\d{1,4}(?:\.\d{1,2})?(?:px|rem|em|%))(?: (?:0|-?\d{1,4}(?:\.\d{1,2})?(?:px|rem|em|%))){0,3}",
            value,
        )
    )


def set_style(element: Tag, changes: dict[str, str]) -> None:
    styles = {}
    for part in str(element.get("style", "")).split(";"):
        key, separator, value = part.partition(":")
        if separator:
            styles[key.strip()] = value.strip()
    for property, value in changes.items():
        if not valid_style(property, value):
            raise ValueError(f"Unsupported value for {property}")
        if value:
            styles[property] = value
        else:
            styles.pop(property, None)
    if styles:
        element["style"] = ";".join(f"{key}:{value}" for key, value in styles.items())
    elif element.has_attr("style"):
        del element["style"]


def canvas_layers(body: str) -> list[dict]:
    soup = BeautifulSoup("<body>" + body + "</body>", "html.parser")
    layers = []

    def walk(parent, prefix="body", depth=0):
        children = [child for child in parent.children if isinstance(child, Tag)]
        for index, child in enumerate(children):
            if child.name in {"script", "style"} or len(layers) >= 400:
                continue
            selector = f"{prefix} > {child.name}:nth-child({index + 1})"
            layers.append(
                {
                    "selector": selector,
                    "tag": child.name,
                    "depth": depth,
                    "label": str(
                        child.get("aria-label")
                        or child.get("alt")
                        or child.get("id")
                        or child.get_text(" ", strip=True)
                        or child.name
                    )[:70],
                    "can_edit": not child.find(True)
                    and child.name not in {"input", "textarea", "img", "svg", "path"},
                }
            )
            walk(child, selector, depth + 1)

    walk(soup.body)
    return layers


def mutate_canvas(
    body: str,
    selector: str,
    operation: str,
    changes: dict[str, str] | None = None,
    selectors: list[str] | None = None,
) -> str:
    soup = BeautifulSoup("<body>" + body + "</body>", "html.parser")
    try:
        element = soup.select_one(selector)
    except Exception:
        raise ValueError("Invalid selection")
    if element is None or element.name in {"html", "body", "script", "style"}:
        raise ValueError("Select a visible element inside the artboard")
    if operation == "style":
        set_style(element, changes or {})
    elif operation == "delete":
        element.decompose()
    elif operation == "duplicate":
        import copy

        duplicate = copy.deepcopy(element)
        suffix = "-copy-" + secrets.token_hex(3)
        mapping = {}
        for tag in [duplicate, *duplicate.find_all(True)]:
            if tag.has_attr("data-design-anchor"):
                del tag["data-design-anchor"]
            if tag.has_attr("id"):
                mapping[tag["id"]] = tag["id"] + suffix
                tag["id"] += suffix
        for tag in [duplicate, *duplicate.find_all(True)]:
            for attr in (
                "href",
                "data-design-target",
                "data-design-filter",
                "data-design-submit",
                "data-design-output",
                "data-design-ai",
                "data-design-speak",
                "data-design-dictate",
            ):
                if str(tag.get(attr, "")).startswith("#") and tag[attr][1:] in mapping:
                    tag[attr] = "#" + mapping[tag[attr][1:]]
            for attr in ("for", "aria-controls", "aria-labelledby", "aria-describedby"):
                if tag.has_attr(attr):
                    tag[attr] = " ".join(
                        mapping.get(value, value) for value in str(tag[attr]).split()
                    )
        element.insert_after(duplicate)
    elif operation in {"move-earlier", "move-later"}:
        neighbor = (
            element.find_previous_sibling()
            if operation == "move-earlier"
            else element.find_next_sibling()
        )
        if neighbor and neighbor.name not in {"script", "style"}:
            element.extract()
            if operation == "move-earlier":
                neighbor.insert_before(element)
            else:
                neighbor.insert_after(element)
    elif operation == "group":
        selected = [element]
        if selectors:
            try:
                selected = [soup.select_one(item) for item in dict.fromkeys(selectors)]
            except Exception:
                raise ValueError("Invalid group selection")
            if not selected or any(
                item is None or item.name in {"body", "html", "script", "style"}
                for item in selected
            ):
                raise ValueError("Select visible layers to group")
            if any(item.parent is not selected[0].parent for item in selected):
                raise ValueError("Select layers with the same parent to group them")
            selected_ids = {id(item) for item in selected}
            selected = [
                child
                for child in selected[0].parent.children
                if id(child) in selected_ids
            ]
        wrapper = soup.new_tag("div", attrs={"data-design-group": "true"})
        selected[0].insert_before(wrapper)
        for item in selected:
            wrapper.append(item.extract())
    elif operation == "ungroup":
        if element.name not in {"div", "section"} or not element.has_attr(
            "data-design-group"
        ):
            raise ValueError("Select a group created in the canvas to ungroup it")
        element.unwrap()
    elif operation in {"flip-horizontal", "flip-vertical"}:
        set_style(
            element,
            {
                "transform": "scaleX(-1)"
                if operation == "flip-horizontal"
                else "scaleY(-1)"
            },
        )
    else:
        raise ValueError("Unsupported canvas operation")
    return soup.body.decode_contents()
