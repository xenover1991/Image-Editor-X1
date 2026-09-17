/*
 * ImageEditor - Developed by xen (206993987125510144)
 * Image Loader Utility
 */

export interface LoadedImage {
    img: HTMLImageElement;
    width: number;
    height: number;
    cleanup: () => void;
}

export async function loadImageSource(source: string | File): Promise<LoadedImage> {
    let objectUrl: string | null = null;

    if (source instanceof File) {
        objectUrl = URL.createObjectURL(source);
    } else if (typeof source === "string") {
        if (source.startsWith("blob:") || source.startsWith("data:")) {
            // Already local / safe
            objectUrl = null;
        } else {
            // Attempt to fetch blob to ensure the canvas is never tainted
            try {
                const response = await fetch(source, { mode: "cors" });
                if (response.ok) {
                    const blob = await response.blob();
                    objectUrl = URL.createObjectURL(blob);
                }
            } catch {
                // Fallback to direct load with anonymous crossOrigin
                objectUrl = null;
            }
        }
    }

    const srcToUse = objectUrl ?? (typeof source === "string" ? source : "");

    return new Promise((resolve, reject) => {
        const img = new Image();
        if (!srcToUse.startsWith("data:") && !srcToUse.startsWith("blob:")) {
            img.crossOrigin = "anonymous";
        }

        img.onload = () => {
            resolve({
                img,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
                cleanup: () => {
                    if (objectUrl) {
                        URL.revokeObjectURL(objectUrl);
                    }
                }
            });
        };

        img.onerror = () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            reject(new Error("Resim yüklenemedi. Lütfen bağlantıyı kontrol edin."));
        };

        img.src = srcToUse;
    });
}
