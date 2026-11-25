# SPDX-License-Identifier: AGPL-3.0-only

import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from markdown.extensions import Extension
from markdown.treeprocessors import Treeprocessor


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "out" / "pages"
REPO = "https://github.com/BulatRuslanovich/caimack"
BRANCH = "master"
GITHUB_DOC_LINK = re.compile(rf'{re.escape(REPO)}/blob/{BRANCH}/docs/([\w/-]+)\.md(?=[#"])')
LANDING_ASSETS = {
    "frontend/public/logo.svg": "logo.svg",
    "frontend/public/logo-mark.svg": "logo-mark.svg",
    "frontend/public/wordmark.svg": "wordmark.svg",
    "android/app/src/main/res/font/onest_variable.ttf": "onest_variable.ttf",
    "landing/Onest-OFL.txt": "Onest-OFL.txt",
}


class RepositoryLinkProcessor(Treeprocessor):
    def __init__(self, md, source_dir, docs_dir):
        super().__init__(md)
        self.source_dir = source_dir
        self.docs_dir = docs_dir

    def run(self, root):
        for link in root.iter("a"):
            url = urlsplit(link.get("href", ""))
            if url.scheme or url.netloc or not url.path.startswith("../"):
                continue
            target = (self.source_dir / unquote(url.path)).resolve()
            if target.is_relative_to(self.docs_dir):
                continue
            if target.is_relative_to(ROOT) and target.exists():
                kind = "tree" if target.is_dir() else "blob"
                path = quote(target.relative_to(ROOT).as_posix())
                link.set("href", url._replace(path=f"{REPO}/{kind}/{BRANCH}/{path}").geturl())


class RepositoryLinks(Extension):
    def __init__(self, source_dir, docs_dir):
        self.source_dir = source_dir
        self.docs_dir = docs_dir

    def extendMarkdown(self, md):
        # Resolve repository links before MkDocs checks links within docs/.
        md.treeprocessors.register(
            RepositoryLinkProcessor(md, self.source_dir, self.docs_dir), "repository_links", 8
        )


def on_page_markdown(markdown, *, page, config, **kwargs):
    extensions = config.markdown_extensions
    if extensions and isinstance(extensions[-1], RepositoryLinks):
        extensions.pop()
    extensions.append(RepositoryLinks(Path(page.file.abs_src_path).parent, Path(config.docs_dir)))


def documentation_url(match):
    source = Path(match[1])
    if source.name == "README":
        return (Path("docs") / source.parent).as_posix() + "/"
    return f"docs/{source.as_posix()}.html"


def main():
    subprocess.run([sys.executable, "-m", "mkdocs", "build", "--strict"], cwd=ROOT, check=True)

    assets = SITE / "assets"
    assets.mkdir(exist_ok=True)
    for source, filename in LANDING_ASSETS.items():
        shutil.copyfile(ROOT / source, assets / filename)

    landing = ROOT / "landing"
    html = (landing / "index.html").read_text(encoding="utf-8")
    html = html.replace("../frontend/public/", "assets/").replace("../docs/", "docs/")
    (SITE / "index.html").write_text(GITHUB_DOC_LINK.sub(documentation_url, html), encoding="utf-8")

    css = (landing / "styles.css").read_text(encoding="utf-8")
    css = css.replace("../android/app/src/main/res/font/", "assets/")
    (SITE / "styles.css").write_text(css, encoding="utf-8")
    shutil.copyfile(landing / "landing.js", SITE / "landing.js")


if __name__ == "__main__":
    main()
