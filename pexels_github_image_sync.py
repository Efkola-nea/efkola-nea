#!/usr/bin/env python3
"""Fetch category images from Pexels and upload them to GitHub for jsDelivr use."""

from __future__ import annotations

import base64
from typing import Iterable

import requests
from github import Github

# ---- Configuration ----
PEXELS_API_KEY = "YOUR_PEXELS_API_KEY"
GITHUB_TOKEN = "YOUR_GITHUB_TOKEN"
REPO_NAME = "your-user-or-org/your-repo"
BRANCH = "main"
CATEGORIES = ["Technology", "Health", "Sports"]
IMAGES_PER_CATEGORY = 10

PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"


def category_folder_name(category: str) -> str:
    """Normalize category names for folder usage."""
    return category.strip().replace(" ", "_").lower()


def fetch_pexels_photos(category: str, per_page: int) -> list[dict]:
    """Fetch landscape photos for a single category from Pexels."""
    response = requests.get(
        PEXELS_SEARCH_URL,
        headers={"Authorization": PEXELS_API_KEY},
        params={
            "query": category,
            "orientation": "landscape",
            "per_page": per_page,
            "page": 1,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json().get("photos", [])


def download_image_bytes(image_url: str) -> bytes:
    """Download image bytes directly into memory (no local file writes)."""
    response = requests.get(image_url, timeout=30)
    response.raise_for_status()
    return response.content


def upsert_file_base64(repo, path: str, image_bytes: bytes, branch: str, message: str) -> None:
    """Create or update a file in GitHub using base64 content."""
    encoded_content = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "message": message,
        "content": encoded_content,
        "branch": branch,
    }

    try:
        existing = repo.get_contents(path, ref=branch)
        payload["sha"] = existing.sha
    except Exception:
        pass

    # Use GitHub Contents API via PyGithub requester to preserve binary uploads.
    repo._requester.requestJsonAndCheck(
        "PUT",
        f"{repo.url}/contents/{path}",
        input=payload,
    )


def build_jsdelivr_url(repo_name: str, branch: str, path: str) -> str:
    """Create jsDelivr CDN URL for a repository asset."""
    return f"https://cdn.jsdelivr.net/gh/{repo_name}@{branch}/{path}"


def process_categories(categories: Iterable[str]) -> None:
    """Fetch, upload and print CDN links for all categories."""
    gh = Github(GITHUB_TOKEN)
    repo = gh.get_repo(REPO_NAME)

    for category in categories:
        safe_category = category_folder_name(category)
        photos = fetch_pexels_photos(category, IMAGES_PER_CATEGORY)

        if not photos:
            print(f"No photos found for category: {category}")
            continue

        print(f"\nCategory: {category}")

        for index, photo in enumerate(photos[:IMAGES_PER_CATEGORY], start=1):
            image_url = photo.get("src", {}).get("original")
            if not image_url:
                continue

            image_bytes = download_image_bytes(image_url)
            image_path = f"images/{safe_category}/img_{index}.jpg"

            upsert_file_base64(
                repo=repo,
                path=image_path,
                image_bytes=image_bytes,
                branch=BRANCH,
                message=f"Add {category} image {index}",
            )

            print(build_jsdelivr_url(REPO_NAME, BRANCH, image_path))


def validate_config() -> None:
    """Ensure required placeholders are filled before running."""
    required_values = {
        "PEXELS_API_KEY": PEXELS_API_KEY,
        "GITHUB_TOKEN": GITHUB_TOKEN,
        "REPO_NAME": REPO_NAME,
    }

    missing = [key for key, value in required_values.items() if value.startswith("YOUR_") or not value.strip()]
    if missing:
        raise ValueError(f"Please configure: {', '.join(missing)}")


if __name__ == "__main__":
    validate_config()
    process_categories(CATEGORIES)
