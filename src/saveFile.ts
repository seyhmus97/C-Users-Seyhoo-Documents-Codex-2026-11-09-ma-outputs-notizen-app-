import { Capacitor } from "@capacitor/core";

const asBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** Save via the platform share sheet in native mobile apps; use a browser download on desktop/web. */
export async function saveFile(blob: Blob, filename: string) {
  const safeName = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "Notizraum-Datei";
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const { uri } = await Filesystem.writeFile({ path: safeName, data: await asBase64(blob), directory: Directory.Cache });
    await Share.share({ title: safeName, url: uri, dialogTitle: "Datei speichern oder teilen" });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
