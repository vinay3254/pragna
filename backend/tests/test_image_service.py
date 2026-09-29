import base64
import httpx
import respx
from app.image_service import generate_image, edit_image


@respx.mock
async def test_generate_image_success():
    respx.post("https://api.stability.ai/v2beta/stable-image/generate/sd3").mock(
        return_value=httpx.Response(200, json={"image": "ZmFrZS1pbWFnZS1ieXRlcw==", "finish_reason": "SUCCESS"})
    )

    result = await generate_image("a red fox in the snow", api_key="test-key")

    assert result["success"] is True
    assert result["image_base64"] == "ZmFrZS1pbWFnZS1ieXRlcw=="
    assert result["prompt"] == "a red fox in the snow"


async def test_generate_image_no_api_key_returns_error_without_request():
    result = await generate_image("a red fox", api_key="")
    assert result["success"] is True
    assert "pollinations" in result["image_url"]


@respx.mock
async def test_generate_image_http_error():
    respx.post("https://api.stability.ai/v2beta/stable-image/generate/sd3").mock(
        return_value=httpx.Response(400, json={"errors": ["invalid prompt"]})
    )

    result = await generate_image("bad prompt", api_key="test-key")

    assert result["success"] is True
    assert "pollinations" in result["image_url"]



@respx.mock
async def test_edit_image_success():
    respx.post("https://api.stability.ai/v2beta/stable-image/generate/sd3").mock(
        return_value=httpx.Response(200, json={"image": "ZWRpdGVkLWJ5dGVz", "finish_reason": "SUCCESS"})
    )

    source = base64.b64encode(b"original-image-bytes").decode("ascii")
    result = await edit_image(source, "make the sky purple", api_key="test-key")

    assert result["success"] is True
    assert result["image_base64"] == "ZWRpdGVkLWJ5dGVz"


async def test_edit_image_no_api_key_returns_error_without_request():
    source = base64.b64encode(b"x").decode("ascii")
    result = await edit_image(source, "make it darker", api_key="")
    assert result["success"] is False
    assert "STABILITY_API_KEY" in result["error"]
