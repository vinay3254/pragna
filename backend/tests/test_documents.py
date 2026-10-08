from pathlib import Path


def test_upload_txt_document(client, test_settings):
    files = {"file": ("note.txt", b"Pragna is a local chatbot.", "text/plain")}
    response = client.post("/api/documents/upload", files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "note.txt"
    assert body["chunk_count"] >= 1

    list_response = client.get("/api/documents")
    assert list_response.status_code == 200
    assert any(d["filename"] == "note.txt" for d in list_response.json())

    saved_path = Path(test_settings.documents_dir) / "note.txt"
    assert saved_path.exists()


def test_upload_rejects_unsupported_file_type(client):
    files = {"file": ("virus.exe", b"binary", "application/octet-stream")}
    response = client.post("/api/documents/upload", files=files)
    assert response.status_code == 400


def test_startup_ingests_existing_folder_files(tmp_path):
    from app.main import create_app
    from app.config import Settings
    from fastapi.testclient import TestClient

    documents_dir = tmp_path / "documents"
    documents_dir.mkdir()
    (documents_dir / "preexisting.txt").write_text("Existing content about pragna.")

    settings = Settings(
        _env_file=None,
        db_path=str(tmp_path / "pragna.db"),
        chroma_path=str(tmp_path / "chroma"),
        documents_dir=str(documents_dir),
        jwt_secret="test-secret-not-for-production",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        register_res = client.post(
            "/api/auth/register", json={"email": "test@example.com", "password": "testpassword123"}
        )
        token = register_res.json()["access_token"]
        client.headers.update({"Authorization": f"Bearer {token}"})

        response = client.get("/api/documents")
        assert response.status_code == 200
        assert any(d["filename"] == "preexisting.txt" for d in response.json())
