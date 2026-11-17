import pytest
from app.main import create_app
from fastapi.testclient import TestClient


def test_pragna_personas_routes(client):
    res = client.get("/api/personas")
    assert res.status_code == 200
    data = res.json()
    assert "personas" in data
    assert len(data["personas"]) >= 4

    create_res = client.post("/api/personas", json={"name": "Custom Bot", "system_prompt": "You are a test bot."})
    assert create_res.status_code == 200
    created = create_res.json()
    assert created["success"] is True


def test_pragna_models_catalog_route(client):
    res = client.get("/api/models/catalog")
    assert res.status_code == 200
    data = res.json()
    assert "models" in data
    assert len(data["models"]) >= 4


def test_pragna_images_routes(client):
    cfg_res = client.get("/api/images/config")
    assert cfg_res.status_code == 200
    cfg = cfg_res.json()
    assert "styles" in cfg
    assert "qualities" in cfg

    gen_res = client.post("/api/images/generate", json={"prompt": "cyberpunk city", "style": "cinematic"})
    assert gen_res.status_code == 200
    gen = gen_res.json()
    assert gen["success"] is True
    assert "image_url" in gen


def test_pragna_documents_generate_route(client):
    res = client.post("/api/documents/generate", json={"format": "docx", "prompt": "Quarterly Financial Report"})
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "download_url" in data


def test_pragna_agent_modes_route(client):
    res = client.get("/api/agent/modes")
    assert res.status_code == 200
    data = res.json()
    assert "modes" in data
    assert len(data["modes"]) >= 6
