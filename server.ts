import { watch } from "fs";
import { join } from "path";

const PORT = 3000;
const ROOT = import.meta.dir;
const SITE = join(ROOT, "_site");

let building: Promise<void> | null = null;
let rebuildTimer: Timer | null = null;

async function jekyllBuild(reason = "startup") {
  if (building) {
    await building;
    return;
  }

  building = (async () => {
    console.log(`[jekyll] building (${reason})…`);
    const proc = Bun.spawn(["./scripts/jekyll", "build"], {
      cwd: ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      console.error(`[jekyll] build failed with exit code ${code}`);
      return;
    }
    console.log("[jekyll] done");
  })();

  try {
    await building;
  } finally {
    building = null;
  }
}

function scheduleJekyllRebuild(reason: string) {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    void jekyllBuild(reason);
  }, 200);
}

function watchJekyllSources() {
  const targets = ["_posts", "_layouts", "_plugins", "blog.html", "_config.yml"];

  for (const target of targets) {
    const path = join(ROOT, target);
    try {
      watch(path, { recursive: true }, (_event, filename) => {
        scheduleJekyllRebuild(filename ? `${target}/${filename}` : target);
      });
    } catch {
      // Missing optional paths are fine (e.g. empty plugin dir on some setups).
    }
  }
}

/** Jekyll-generated routes that must come from _site, not the Liquid source. */
function isJekyllRoute(pathname: string): boolean {
  return (
    pathname === "/blog.html" ||
    pathname === "/blog" ||
    /^\/\d{4}\/\d{2}\/\d{2}\//.test(pathname)
  );
}

async function resolveFile(pathname: string): Promise<ReturnType<typeof Bun.file> | null> {
  const path = pathname === "/" ? "/index.html" : pathname;
  const siteFile = Bun.file(join(SITE, path));
  const srcFile = Bun.file(join(ROOT, path));

  if (isJekyllRoute(path)) {
    if (await siteFile.exists()) return siteFile;
    return null;
  }

  // Prefer source so CSS/assets update without a Jekyll rebuild.
  if (await srcFile.exists()) return srcFile;
  if (await siteFile.exists()) return siteFile;
  return null;
}

await jekyllBuild("startup");
watchJekyllSources();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const file = await resolveFile(url.pathname);

    if (file) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Serving at http://localhost:${PORT}`);
