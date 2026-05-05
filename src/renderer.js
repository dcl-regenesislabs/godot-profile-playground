import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchProfile, HttpError } from "./catalyst.js";

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

function runDocker({ image, avatarsPath, outputDir, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const containerName = `gpv-${randomUUID()}`;
    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      "-v",
      `${avatarsPath}:/app/avatars.json:ro`,
      "-v",
      `${outputDir}:/app/output`,
      image,
    ];

    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });

    const timer = setTimeout(() => {
      spawn("docker", ["kill", containerName], { stdio: "ignore" });
      reject(new HttpError(504, `docker run timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new HttpError(500, `failed to spawn docker: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new HttpError(500, `docker exited ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

async function readPngAsDataUrl(path) {
  const buf = await readFile(path);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export async function renderProfile(address, opts) {
  const {
    catalystUrl,
    dockerImage,
    timeoutMs,
  } = opts;

  const profile = await fetchProfile(address, catalystUrl);
  const tmpDir = join(tmpdir(), `gpv-${randomUUID()}`);
  const outputDir = join(tmpDir, "output");
  const avatarsPath = join(tmpDir, "avatars.json");

  try {
    await mkdir(outputDir, { recursive: true });
    const payload = buildPayload({
      ethAddress: profile.ethAddress,
      avatar: profile.avatar,
      catalystUrl,
    });
    await writeFile(avatarsPath, JSON.stringify(payload, null, 2));

    await runDocker({
      image: dockerImage,
      avatarsPath,
      outputDir,
      timeoutMs,
    });

    const bodyPath = join(outputDir, `${profile.ethAddress}.png`);
    const facePath = join(outputDir, `${profile.ethAddress}_face.png`);

    const [body, face] = await Promise.all([
      readPngAsDataUrl(bodyPath),
      readPngAsDataUrl(facePath).catch(() => null),
    ]);

    return {
      name: profile.name,
      address: profile.ethAddress,
      body,
      face,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
