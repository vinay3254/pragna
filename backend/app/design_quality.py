"""Explainable source checks, not a claim that a prototype passed browser testing."""

from bs4 import BeautifulSoup

ACTIONS = {
    "tab",
    "toggle",
    "show",
    "hide",
    "open-dialog",
    "close-dialog",
    "filter",
    "toast",
}


def contrast_ratio(foreground: str, background: str) -> float:
    def luminance(value):
        channels = [int(value[i : i + 2], 16) / 255 for i in (1, 3, 5)]
        linear = [
            c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
            for c in channels
        ]
        return sum(c * w for c, w in zip(linear, (0.2126, 0.7152, 0.0722)))

    light, dark = sorted((luminance(foreground), luminance(background)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def inspect_body(body: str, theme: dict | None = None) -> dict:
    soup = BeautifulSoup(body, "html.parser")
    issues = []

    def issue(code, message, severity="warning"):
        entry = {"code": code, "message": message, "severity": severity}
        if entry not in issues and len(issues) < 24:
            issues.append(entry)

    ids = {}
    for element in soup.select("[id]"):
        identifier = element["id"]
        if identifier in ids:
            issue(
                "duplicate_id",
                f'Duplicate id "{identifier[:80]}" can break controls.',
                "error",
            )
        ids[identifier] = element

    scripts = [
        script for script in soup.find_all("script") if script.get_text(strip=True)
    ]
    actions = soup.select("[data-design-action]")
    targets = (
        "data-design-target",
        "data-design-filter",
        "data-design-output",
        "data-design-submit",
        "data-design-ai",
        "data-design-speak",
        "data-design-dictate",
    )
    for element in soup.select(", ".join(f"[{attribute}]" for attribute in targets)):
        for attribute in targets:
            if not element.has_attr(attribute):
                continue
            selector = element[attribute]
            try:
                target = soup.select_one(selector)
            except Exception:
                target = None
            if target is None:
                issue(
                    "missing_target",
                    f'Control points to missing target "{str(selector)[:80]}".',
                    "error",
                )
            elif element.get("data-design-action") == "tab":
                group = element.find_parent(attrs={"data-design-tabs": True})
                if (
                    not group
                    or target not in group.descendants
                    or not target.has_attr("data-design-panel")
                ):
                    issue(
                        "invalid_tab",
                        "Tab needs a panel inside the same data-design-tabs group.",
                        "error",
                    )
            elif (
                element.get("data-design-action") == "open-dialog"
                and target.name != "dialog"
            ):
                issue(
                    "invalid_dialog",
                    "Open dialog action needs a native dialog target.",
                    "error",
                )

    for element in actions:
        action = element.get("data-design-action")
        if action not in ACTIONS:
            issue(
                "unknown_action",
                f'Unsupported prototype action "{str(action)[:60]}".',
                "error",
            )
        if action not in {"toast", "close-dialog"} and not element.get(
            "data-design-target"
        ):
            issue(
                "missing_target",
                f'"{action}" control needs data-design-target.',
                "error",
            )
        if (
            action == "close-dialog"
            and not element.get("data-design-target")
            and not element.find_parent("dialog")
        ):
            issue(
                "invalid_dialog",
                "Close dialog control needs a dialog target or enclosing dialog.",
                "error",
            )

    for element in soup.select("button, a"):
        name = (
            element.get("aria-label")
            or element.get_text(strip=True)
            or element.get("title")
        )
        if not name and not element.get("aria-labelledby"):
            issue("unnamed_control", "An icon control needs an accessible label.")
        if element.name == "a":
            href = element.get("href", "")
            if href.startswith("#") and len(href) > 1 and href[1:] not in ids:
                issue(
                    "broken_anchor",
                    f'Link points to missing section "{href[:80]}".',
                    "error",
                )
            if href in {"", "#"} and not (
                scripts or element.get("data-design-action") or element.get("onclick")
            ):
                issue(
                    "dead_link", "A navigation link has no destination or local action."
                )
        elif not element.has_attr("disabled") and not (
            scripts
            or element.get("data-design-action")
            or element.get("onclick")
            or element.has_attr("data-design-speak")
            or element.has_attr("data-design-dictate")
        ):
            form = element.find_parent("form")
            submit = (
                form
                and element.get("type", "submit") == "submit"
                and (
                    form.has_attr("data-design-submit")
                    or form.has_attr("data-design-ai")
                )
            )
            if not submit:
                issue(
                    "unwired_button",
                    "A button has no local interaction. Wire it or mark it disabled.",
                )

    for field in soup.select('input:not([type="hidden"]), textarea, select'):
        label = field.find_parent("label") or (
            soup.find("label", attrs={"for": field["id"]}) if field.get("id") else None
        )
        if (
            not label
            and not field.get("aria-label")
            and not field.get("aria-labelledby")
        ):
            issue(
                "unlabeled_field",
                "A form field needs a visible label or accessible name.",
            )
    for image in soup.find_all("img"):
        if not image.has_attr("alt"):
            issue("image_alt", "An image needs alt text, or empty alt for decoration.")
    if theme:
        for foreground, background, label in (
            ("foreground", "background", "Body text"),
            ("foreground", "surface", "Surface text"),
            ("muted", "background", "Secondary text"),
            ("muted", "surface", "Secondary surface text"),
            ("on_primary", "primary", "Primary button text"),
        ):
            ratio = contrast_ratio(theme[foreground], theme[background])
            if ratio < 4.5:
                issue(
                    "theme_contrast",
                    f"{label} theme contrast is {ratio:.2f}:1; use at least 4.5:1.",
                )

    return {
        "kind": "source",
        "issues": issues,
        "controls": len(
            soup.select('button, a, input:not([type="hidden"]), select, textarea')
        ),
        "local_actions": len(actions)
        + len(
            soup.select(
                "[data-design-filter], [data-design-submit], [data-design-output], [data-design-ai], [data-design-speak], [data-design-dictate]"
            )
        ),
        "has_custom_script": bool(scripts),
    }
