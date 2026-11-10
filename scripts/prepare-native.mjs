import { copyFile, cp, mkdir, readdir, writeFile } from "node:fs/promises";

// Tauri and Capacitor both open index.html from their embedded local webview.
await copyFile(new URL("../dist/app.html", import.meta.url), new URL("../dist/index.html", import.meta.url));

const iconRoot = new URL("../src-tauri/icons/", import.meta.url);
const androidRes = new URL("../android/app/src/main/res/", import.meta.url);
try {
  for (const name of await readdir(new URL("android/", iconRoot), { withFileTypes: true })) {
    if (name.isDirectory()) await cp(new URL(`android/${name.name}/`, iconRoot), new URL(`${name.name}/`, androidRes), { recursive: true, force: true });
  }
} catch { /* Capacitor Android project has not been generated yet. */ }

const iosIcons = new URL("ios/", iconRoot);
const appIconSet = new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset/", import.meta.url);
try {
  await mkdir(appIconSet, { recursive: true });
  for (const name of await readdir(iosIcons)) await copyFile(new URL(name, iosIcons), new URL(name, appIconSet));
  const images = [
    ["AppIcon-20x20@2x.png", "iphone", "2x", "20x20"], ["AppIcon-20x20@3x.png", "iphone", "3x", "20x20"],
    ["AppIcon-29x29@2x.png", "iphone", "2x", "29x29"], ["AppIcon-29x29@3x.png", "iphone", "3x", "29x29"],
    ["AppIcon-40x40@2x.png", "iphone", "2x", "40x40"], ["AppIcon-40x40@3x.png", "iphone", "3x", "40x40"],
    ["AppIcon-60x60@2x.png", "iphone", "2x", "60x60"], ["AppIcon-60x60@3x.png", "iphone", "3x", "60x60"],
    ["AppIcon-20x20@1x.png", "ipad", "1x", "20x20"], ["AppIcon-20x20@2x-1.png", "ipad", "2x", "20x20"],
    ["AppIcon-29x29@1x.png", "ipad", "1x", "29x29"], ["AppIcon-29x29@2x-1.png", "ipad", "2x", "29x29"],
    ["AppIcon-40x40@1x.png", "ipad", "1x", "40x40"], ["AppIcon-40x40@2x-1.png", "ipad", "2x", "40x40"],
    ["AppIcon-76x76@1x.png", "ipad", "1x", "76x76"], ["AppIcon-76x76@2x.png", "ipad", "2x", "76x76"],
    ["AppIcon-83.5x83.5@2x.png", "ipad", "2x", "83.5x83.5"],
    ["AppIcon-512@2x.png", "ios-marketing", "1x", "1024x1024"],
  ].map(([filename, idiom, scale, size]) => ({ filename, idiom, scale, size }));
  await writeFile(new URL("Contents.json", appIconSet), JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2) + "\n");
} catch { /* Capacitor iOS project has not been generated yet. */ }
