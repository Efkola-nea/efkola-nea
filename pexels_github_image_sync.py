#!/usr/bin/env python3
"""Fetch category images from Pexels and upload them to GitHub for jsDelivr use."""

from __future__ import annotations

import base64
from typing import Iterable

import requests
from github import Github, InputGitTreeElement

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
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f"Pexels request failed for category '{category}': {exc}") from exc
    return response.json().get("photos", [])


def download_image_bytes(image_url: str) -> bytes:
    """Download image bytes directly into memory (no local file writes)."""
    response = requests.get(image_url, timeout=30)
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(f"Image download failed for URL '{image_url}': {exc}") from exc
    return response.content


def upsert_file_base64(repo, path: str, image_bytes: bytes, branch: str, message: str) -> None:
    """Create or update a file in GitHub using public PyGithub Git objects APIs."""
    encoded_content = base64.b64encode(image_bytes).decode("utf-8")
    branch_ref = repo.get_git_ref(f"heads/{branch}")
    parent_commit = repo.get_git_commit(branch_ref.object.sha)
    blob = repo.create_git_blob(encoded_content, "base64")
    tree_element = InputGitTreeElement(path=path, mode="100644", type="blob", sha=blob.sha)
    tree = repo.create_git_tree([tree_element], parent_commit.tree)
    commit = repo.create_git_commit(message, tree, [parent_commit])
    branch_ref.edit(commit.sha)


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
                print(f"Skipping photo {index} for '{category}' because no original URL was returned.")
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

    missing = []
    for key, value in required_values.items():
        value_str = value if isinstance(value, str) else ""
        if value_str.startswith("YOUR_") or not value_str.strip():
            missing.append(key)
    if missing:
        raise ValueError(f"Please configure: {', '.join(missing)}")


if __name__ == "__main__":
    validate_config()
    process_categories(CATEGORIES)
