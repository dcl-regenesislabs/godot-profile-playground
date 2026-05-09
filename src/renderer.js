import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "./catalyst.js";

function buildPayload({ ethAddress, avatar, catalystUrl }) {
  return {
    baseUrl: `${catalystUrl.replace(/\/$/, "")}/content`,
    payload: [
      {
        entity: ethAddress,
        destPath: `output/${ethAddress}.png`,
        width: 512,
        height: 1024,
        faceDestPath: `output/${ethAddress}_face.png`,
        faceWidth: 256,
        faceHeight: 256,
        avatar,
      },
    ],
  };
}

function runGodot({ binary, workdir, timeoutMs, network }) {
  return new Promise((resolve, reject) => {
    const args = ["--rendering-driver", "opengl3", "--avatar-renderer", "--avatars", "avatars.json"];
    if (network === "zone") {
      args.push("--dclenv", "zone");
    }
    const child = spawn(binary, args, {
      cwd: workdir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new HttpError(504, `godot render timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new HttpError(500, `failed to spawn godot: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new HttpError(500, `godot exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

let renderQueue = Promise.resolve();
function withRenderLock(fn) {
  const next = renderQueue.then(fn, fn);
  renderQueue = next.catch(() => {});
  return next;
}

export async function renderProfile({ profile, catalystUrl, network, godotBin, godotWorkdir, timeoutMs }) {
  if (!profile?.ethAddress) {
    throw new HttpError(500, "profile is missing ethAddress");
  }

  return withRenderLock(async () => {
    const avatarsPath = join(godotWorkdir, "avatars.json");
    const outputDir = join(godotWorkdir, "output");
    const bodyPath = join(outputDir, `${profile.ethAddress}.png`);
    const facePath = join(outputDir, `${profile.ethAddress}_face.png`);

    try {
      await mkdir(outputDir, { recursive: true });
      const payload = buildPayload({
        ethAddress: profile.ethAddress,
        avatar: profile.avatar,
        catalystUrl,
      });
      await writeFile(avatarsPath, JSON.stringify(payload, null, 2));

      await runGodot({ binary: godotBin, workdir: godotWorkdir, timeoutMs, network });

      const [bodyBuffer, faceBuffer] = await Promise.all([
        readFile(bodyPath),
        readFile(facePath).catch(() => null),
      ]);

      return {
        name: profile.name,
        address: profile.ethAddress,
        bodyBuffer,
        faceBuffer,
      };
    } finally {
      await Promise.all([
        rm(avatarsPath, { force: true }).catch(() => {}),
        rm(bodyPath, { force: true }).catch(() => {}),
        rm(facePath, { force: true }).catch(() => {}),
      ]);
    }
  });
}
