"""Bounded public-page imports with DNS pinning and redirect validation."""

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup


async def public_address(url: str) -> tuple[str, str]:
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise ValueError("Use a public HTTP or HTTPS URL without credentials")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port != (443 if parsed.scheme == "https" else 80):
        raise ValueError("Only standard website ports are supported")
    addresses = await asyncio.to_thread(
        socket.getaddrinfo, parsed.hostname, port, 0, socket.SOCK_STREAM
    )
    ips = list(dict.fromkeys(item[4][0] for item in addresses))
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ValueError("Only publicly reachable websites can be imported")
    address = "[" + ips[0] + "]" if ":" in ips[0] else ips[0]
    pinned = urlunsplit((parsed.scheme, address, parsed.path or "/", parsed.query, ""))
    return pinned, parsed.hostname


async def capture_reference(url: str, selector: str | None = None) -> str:
    async with asyncio.timeout(20):
        async with httpx.AsyncClient(
            timeout=8, trust_env=False, follow_redirects=False
        ) as client:
            for _ in range(4):
                pinned, hostname = await public_address(url)
                async with client.stream(
                    "GET",
                    pinned,
                    headers={"Host": hostname, "Accept": "text/html"},
                    extensions={"sni_hostname": hostname},
                ) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise ValueError("Website redirect has no destination")
                        url = urljoin(url, location)
                        continue
                    response.raise_for_status()
                    if "text/html" not in response.headers.get("content-type", ""):
                        raise ValueError(
                            "Import an HTML webpage or upload the file instead"
                        )
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 1_000_000:
                            raise ValueError("Website response exceeds 1 MB")
                        chunks.append(chunk)
                    soup = BeautifulSoup(b"".join(chunks), "html.parser")
                    styles = "\n".join(
                        tag.get_text() for tag in soup.find_all("style")
                    )[:12000]
                    try:
                        element = (
                            soup.select_one(selector) if selector else soup.body or soup
                        )
                    except Exception:
                        raise ValueError("Use a valid CSS selector")
                    if not element:
                        raise ValueError("No matching element found in the page HTML")
                    for tag in element.find_all(
                        ["script", "iframe", "object", "embed"]
                    ):
                        tag.decompose()
                    return f"Website reference: {url}\nInline styles:\n{styles}\nMarkup:\n{str(element)[:48000]}"
            raise ValueError("Website has too many redirects")


async def public_image(url: str) -> tuple[bytes, str]:
    """Fetch only approved public image hosts; validate and pin DNS for every request."""
    if urlsplit(url).hostname not in {
        "images.unsplash.com",
        "images.pexels.com",
        "placehold.co",
        "upload.wikimedia.org",
    }:
        raise ValueError("Unsupported export image host")
    pinned, hostname = await public_address(url)
    async with httpx.AsyncClient(
        timeout=6, trust_env=False, follow_redirects=False
    ) as client:
        async with client.stream(
            "GET",
            pinned,
            headers={"Host": hostname},
            extensions={"sni_hostname": hostname},
        ) as response:
            response.raise_for_status()
            media = response.headers.get("content-type", "").split(";")[0]
            if media not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
                raise ValueError("Unsupported export image type")
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > 5_000_000:
                    raise ValueError("Export image exceeds 5 MB")
                chunks.append(chunk)
            return b"".join(chunks), media
