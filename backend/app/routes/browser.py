from typing import Any, Optional
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/tools/browser", tags=["browser"])


def _get_service(request: Request):
    return request.app.state.browser_service


class NavigateRequest(BaseModel):
    url: str


@router.post("/navigate")
async def navigate(request: Request, body: NavigateRequest):
    return await _get_service(request).navigate(body.url)


@router.post("/snapshot")
async def snapshot(request: Request):
    return await _get_service(request).read_page()


@router.post("/screenshot")
async def screenshot(request: Request):
    return await _get_service(request).screenshot()


class ClickRequest(BaseModel):
    selector: str


@router.post("/click")
async def click(request: Request, body: ClickRequest):
    return await _get_service(request).click(body.selector)


class TypeRequest(BaseModel):
    selector: str
    text: str
    clear_first: bool = True


@router.post("/type")
async def type_text(request: Request, body: TypeRequest):
    return await _get_service(request).type_text(body.selector, body.text, body.clear_first)


class ScrollRequest(BaseModel):
    direction: str = "down"
    amount: int = 500
    selector: Optional[str] = None


@router.post("/scroll")
async def scroll(request: Request, body: ScrollRequest):
    return await _get_service(request).scroll(body.direction, body.amount, body.selector)


@router.post("/back")
async def back(request: Request):
    return await _get_service(request).go_back()


class PressRequest(BaseModel):
    key: str
    selector: Optional[str] = None


@router.post("/press")
async def press(request: Request, body: PressRequest):
    return await _get_service(request).press_key(body.key, body.selector)


@router.post("/get_images")
async def get_images(request: Request):
    return await _get_service(request).get_images()


@router.post("/console")
async def console(request: Request):
    return await _get_service(request).get_console_logs()


class DialogRequest(BaseModel):
    action: str = "accept"
    text: str = ""


@router.post("/dialog")
async def dialog(request: Request, body: DialogRequest):
    return await _get_service(request).handle_dialog(body.action, body.text)


class ActRequest(BaseModel):
    description: Optional[str] = None
    steps: list[dict[str, Any]] = []


@router.post("/act")
async def act(request: Request, body: ActRequest):
    return await _get_service(request).act(body.steps)


@router.post("/exec")
async def exec_workflow(request: Request, body: ActRequest):
    return await _get_service(request).act(body.steps)
